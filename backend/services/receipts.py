"""Turn payment-receipt text into a draft transaction.

The text comes from on-device OCR of a GPay / PhonePe / Paytm / BHIM
screenshot, from text shared by those apps, or from a bank SMS. OCR is
imperfect (the ₹ sign is often read as %, 2 or 7), so every field is a best
guess that the user confirms before anything is saved.
"""

import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from services.categories import EXPENSE_CATEGORIES, INCOME_CATEGORIES
from services.money import cents_to_input

MAX_TEXT_LENGTH = 20_000
MAX_AMOUNT_CENTS = 10_000_000_00  # ₹1 crore: anything above is almost surely an ID

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}
MONTH_RE = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"

# A number such as 250, 1,250.50 or 1,23,456 (Indian grouping).
NUMBER = r"(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?"
CURRENCY = r"(?:₹|rs\.?|inr|rupees?)"
# Characters OCR commonly produces in place of ₹ when it sits right before digits.
RUPEE_LOOKALIKES = "%=?¥€£$&zZ"
# The same, minus letters, for amounts: "Z139" on its own is a bank branch code (see find_amount).
RUPEE_SYMBOL_LOOKALIKES = "%=?¥€£$&*"
# ...and digits it sometimes becomes when glued to the amount ("₹349" -> "3349").
RUPEE_DIGIT_MISREADS = "23479"

AMOUNT_LABELS = re.compile(
    r"\b(amount|amt|total|paid|debited|sent|payment of|txn amt|transferred|received|credited)\b", re.I)
DATE_OR_TIME = re.compile(r"\d{1,2}:\d{2}|\b(am|pm)\b", re.I)
# The amount to pay on a bill, as opposed to its subtotal or tax lines.
TOTAL_LABELS = re.compile(
    r"\b(grand\s*total|net\s*(?:payable|amount|total)|amount\s*payable|total\s*(?:amount|payable|due)"
    r"|bill\s*(?:total|amount)|total)\b", re.I)
# Lines whose numbers are never the payment: balances, subtotals, taxes, change given.
NOT_AN_AMOUNT_LINE = re.compile(
    r"\b(sub\s*-?\s*total|taxable|discount|c\s*gst|s\s*g\s*[s5]t|igst|gst|vat|tax|balance|bal|avl|available"
    r"|change|tendered|round(?:ing)?\s*off|qty|rate|mrp|you\s+saved?|savings)\b", re.I)
# "Paid 200", "Payment of ¥29 to …", "Paid ¥ 50" — not "Paid 9 May" or "paid 10:30 pm".
PAYMENT_PHRASE_AMOUNT = re.compile(
    r"\b(?:paid|payment\s+of|sent|received|debited|credited|transferred)\s*(?:by\s+|with\s+)?"
    r"(?:₹|rs\.?|inr|[%=¥€£$*])?\s*" + NUMBER +
    r"(?![\d,.]*\d)(?!\s*(?:am\b|pm\b|a\.m|p\.m|:|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)))", re.I)
# "Rupees Five Hundred Only", printed under the amount on Paytm receipts and bank slips.
AMOUNT_IN_WORDS = re.compile(r"\b(?:rupees|inr)\s+([a-z][a-z\s-]{2,80}?)\s+only\b", re.I)
SMALL_NUMBERS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen"
    " seventeen eighteen nineteen".split())}
SMALL_NUMBERS.update({w: (i + 2) * 10 for i, w in enumerate(
    "twenty thirty forty fifty sixty seventy eighty ninety".split())})
BIG_NUMBERS = {"thousand": 1_000, "lakh": 100_000, "lakhs": 100_000, "lac": 100_000, "lacs": 100_000,
               "crore": 10_000_000, "crores": 10_000_000}

APPS = [
    ("Google Pay", r"google\s*pay|\bg\s?pay\b"),
    ("PhonePe", r"phone\s*pe"),
    ("Paytm", r"paytm"),
    ("BHIM", r"\bbhim\b"),
    ("Amazon Pay", r"amazon\s*pay"),
    ("CRED", r"\bcred\b"),
    ("WhatsApp Pay", r"whatsapp"),
    ("MobiKwik", r"mobikwik"),
]

# Checked in order; first keyword hit wins. Brands before generic words.
CATEGORY_KEYWORDS = [
    ("Food", ["swiggy", "zomato", "domino", "pizza", "kfc", "mcdonald", "burger", "starbucks", "cafe", "café",
              "coffee", "restaurant", "dhaba", "biryani", "bakery", "eatery", "food", "chai", "juice", "canteen"]),
    ("Groceries", ["bigbasket", "big basket", "blinkit", "zepto", "instamart", "grofers", "dmart", "d-mart",
                   "jiomart", "reliance fresh", "more retail", "grocery", "groceries", "supermarket", "kirana",
                   "vegetable", "fruits", "provision", "general store", "mart"]),
    ("Travel", ["irctc", "makemytrip", "goibibo", "redbus", "cleartrip", "ixigo", "indigo", "air india", "vistara",
                "spicejet", "akasa", "oyo", "airbnb", "hotel booking", "flight", "train ticket"]),
    ("Transport", ["uber", "ola", "rapido", "namma yatri", "metro", "fastag", "petrol", "diesel", "fuel",
                   "indian oil", "iocl", "bharat petroleum", "bpcl", "hindustan petroleum", "hpcl", "shell",
                   "parking", "toll", "auto", "cab", "taxi", "bus pass"]),
    ("Bills", ["electricity", "bescom", "tneb", "msedcl", "bses", "tata power", "airtel", "jio", "vodafone",
               "vi recharge", "bsnl", "recharge", "broadband", "wifi", "water bill", "gas bill", "lpg", "indane",
               "bharat gas", "dth", "tata play", "insurance", "emi", "credit card bill", "bill payment", "postpaid"]),
    ("Rent", ["rent", "landlord", "house owner", "pg ", "hostel", "nobroker"]),
    ("Health", ["pharmacy", "medical", "chemist", "apollo", "medplus", "1mg", "pharmeasy", "netmeds", "hospital",
                "clinic", "doctor", "diagnostic", "lab", "dental", "gym", "cult.fit", "cultfit"]),
    ("Entertainment", ["netflix", "spotify", "hotstar", "prime video", "youtube", "bookmyshow", "pvr", "inox",
                       "cinema", "movie", "gaming", "steam", "playstation", "zee5", "sonyliv", "jiocinema"]),
    ("Shopping", ["amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa", "croma", "reliance digital",
                  "decathlon", "lifestyle", "shoppers stop", "zara", "h&m", "ikea", "store", "shop", "fashion"]),
    ("Education", ["udemy", "coursera", "byju", "unacademy", "vedantu", "school", "college", "university",
                   "tuition", "coaching", "course", "exam fee", "books", "stationery"]),
]
INCOME_KEYWORDS = [
    ("Salary", ["salary", "payroll", "wages"]),
    ("Investment", ["dividend", "interest", "mutual fund", "zerodha", "groww"]),
    ("Freelance", ["freelance", "invoice", "upwork", "fiverr"]),
]

# "Received ₹1,200 from Rahul" and "Payment to you" are credits; "received by Paytm" (the shop got
# the user's money) is not.
INCOME_HINTS = re.compile(
    r"\b(received\s+(?:[^\n]{0,30}?\s)?from|money\s+received|you\s+received|has\s+been\s+credited"
    r"|credited\s+(?:to|in)\s+your|credited\s+with|cashback\s+received|refund\s+(?:of|received)"
    r"|received\s+successfully|payment\s+to\s+you|paid\s+you|sent\s+you|you\s+got)\b", re.I)
EXPENSE_HINTS = re.compile(
    r"\b(paid\s+to|paid\s+successfully|payment\s+successful|debited|sent\s+to|money\s+sent|you\s+paid"
    r"|transferred\s+to|payment\s+to(?!\s+you)|payment\s+of|received\s+by|paid\s+(?:₹|rs)"
    r"|grand\s+total|bill\s+(?:no|total|amount)|invoice)\b", re.I)

PAYEE_LINE = re.compile(
    r"^(?:paid\s+successfully\s+to|money\s+sent\s+to|payment\s+to|transferred\s+to|paid\s+to|sent\s+to"
    r"|paying|to)\b\s*[:\-]?\s*(.*)$", re.I)
PAYER_LINE = re.compile(
    r"^(?:money\s+received\s+from|received\s+from|credited\s+by|from)\b\s*[:\-]?\s*(.*)$", re.I)
# Name ends at a keyword, a bracket, a comma/semicolon, a sentence-ending full
# stop (not the dot inside "okaxis.com" or a VPA) or the end of the line.
_NAME_END = r"(?=\s*[(\[]|[,;\n]|\.(?:\s|$)|$|\s+(?:on|via|using|ref|refno|upi|from|for|to|in|a/c|is|was)\b)"
INLINE_PAYEE = re.compile(
    r"\b(?:paid|sent|trf|transferred|payment|debited)\b[^\n]{0,60}?\bto\s+(?:vpa\s+)?"
    r"([A-Za-z0-9][\w .&'@/-]{1,50}?)" + _NAME_END, re.I)
INLINE_PAYER = re.compile(
    r"\breceived\b[^\n]{0,40}?\bfrom\s+(?:vpa\s+)?"
    r"([A-Za-z0-9][\w .&'@/-]{1,50}?)" + _NAME_END, re.I)

REFERENCE_PATTERNS = [
    re.compile(r"(?:upi\s*(?:transaction|txn|ref(?:erence)?)\.?\s*(?:id|no\.?|number)?|\butr(?:\s*no\.?)?"
               r"|\brrn|\bref\s*no\.?|\brefno)\s*[:#.\-]?\s*(\d(?: ?\d){11})(?!\d)", re.I),
    re.compile(r"(?:transaction|txn|order|reference)\.?\s*(?:id|no\.?|number)\s*[:#.\-]?\s*([A-Za-z0-9]{10,35})\b",
               re.I),
    re.compile(r"(?<![\d,.])(\d{12})(?![\d,.])"),  # a bare 12-digit UPI RRN
]

NOT_A_NAME = re.compile(
    r"^(?:\W*|₹.*|rs\.?\s*\d.*|\d[\d,. ]*|.*successful.*|.*completed.*|upi.*|google pay|phonepe|paytm"
    r"|banking name.*|split.*|share.*|view.*|done|pay again|check balance|your\b.*|you|me|self)$", re.I)


@dataclass
class Receipt:
    kind: str = "expense"
    amount_cents: int | None = None
    date: str | None = None
    payee: str | None = None
    reference: str | None = None
    category: str = "Other"
    app: str | None = None
    time: str | None = None
    found: set = field(default_factory=set)
    amount_confident: bool = False
    kind_confident: bool = False

    @property
    def warnings(self):
        """Fields the user should double-check on the review screen."""
        out = []
        if not self.amount_cents or not self.amount_confident:
            out.append("amount")
        if not self.kind_confident:
            out.append("direction")
        return out

    def is_clear(self):
        """Everything needed to save without a review screen was read with confidence."""
        return self.amount_confident and {"amount", "date", "payee"} <= self.found

    def to_form(self, today):
        """Values for the transaction form. Missing fields get safe defaults."""
        description = self.payee or (f"{self.app} payment" if self.app else "")
        return {
            "kind": self.kind,
            "amount": cents_to_input(self.amount_cents) if self.amount_cents else "",
            "category": self.category,
            "date": self.date or today.isoformat(),
            "description": description[:200],
            "reference": self.reference or "",
            "time": self.time or "",
            "method": self.app or "",
        }


# ------------------------------------------------------------------ #
# Field extractors                                                    #
# ------------------------------------------------------------------ #

def normalise(text):
    text = (text or "")[:MAX_TEXT_LENGTH].replace("\r", "\n").replace("₹", "₹")
    lines = [re.sub(r"[ \t ]+", " ", line).strip() for line in text.split("\n")]
    return [line for line in lines if line]


def _to_cents(whole, frac):
    digits = whole.replace(",", "")
    if not digits or len(digits) > 9:
        return None
    cents = int(digits) * 100 + (int((frac or "0").ljust(2, "0")[:2]) if frac else 0)
    return cents if 0 < cents <= MAX_AMOUNT_CENTS else None


def words_to_number(words):
    """"five hundred" -> 500, "one lakh twenty thousand" -> 120000; None if any word isn't a number."""
    total = current = 0
    for word in re.split(r"[\s-]+", words.lower()):
        if word in ("", "and"):
            continue
        if word in SMALL_NUMBERS:
            current += SMALL_NUMBERS[word]
        elif word == "hundred":
            current = (current or 1) * 100
        elif word in BIG_NUMBERS:
            total += (current or 1) * BIG_NUMBERS[word]
            current = 0
        else:
            return None
    return (total + current) or None


def find_amount(lines):
    """Best-guess payment amount in cents, or None."""
    return find_amount_with_confidence(lines)[0]


def _rupee_read_as_digit(raw):
    """"210,000" for "₹10,000": OCR turned ₹ into a digit, which also breaks Indian grouping.

    Indian apps write 2,10,000; a first group of three digits followed by more groups
    means the leading digit doesn't belong. Returns the corrected number string or None.
    """
    if raw[0] in RUPEE_DIGIT_MISREADS and re.fullmatch(r"\d{3}(?:,\d{3})+", raw):
        rest = raw[1:]
        if re.fullmatch(r"\d{1,2}(?:,\d{2})*,\d{3}", rest):
            return rest
    return None


def find_amount_with_confidence(lines, heights=None):
    """(cents or None, confident).

    Confident means the amount is backed by more than a bare number: a rupee sign
    (or its usual OCR look-alike), a payment phrase ("Paid 200"), the amount in words,
    the same value found twice, or the telltale "₹349 read as 3349" twin. Uncertain
    amounts are still returned, and the review screen asks the user to check them.

    `heights` (optional, one per line) is the text height from OCR: the payment
    amount is usually the biggest number on a payment screen.
    """
    candidates = []  # (score, order, cents, raw)
    corrected = set()  # values that only exist because we fixed an OCR misread
    order = 0
    tall = 0
    if heights and any(heights):
        known = sorted(h for h in heights if h)
        tall = known[len(known) // 2] * 1.5

    def add(score, cents, raw):
        nonlocal order
        if cents:
            candidates.append((score, order, cents, raw))
            order += 1

    line_end_values = []
    for i, line in enumerate(lines):
        if NOT_AN_AMOUNT_LINE.search(line):
            continue
        labelled = bool(AMOUNT_LABELS.search(line))
        total = 3 if TOTAL_LABELS.search(line) else 0
        big = bool(tall and heights[i] and heights[i] >= tall)
        near = " ".join(lines[max(0, i - 3): i + 4])
        for m in re.finditer(CURRENCY + r"\s*" + NUMBER, line, re.I):
            add(5 + labelled + total + big, _to_cents(m.group(1), m.group(2)), m.group(0))
        # "Paid 200", "Payment of ¥29 to …", "Paid ¥ 50": a payment phrase right before the number.
        for m in PAYMENT_PHRASE_AMOUNT.finditer(line):
            add(4 + big, _to_cents(m.group(1), m.group(2)), m.group(0))
        # "%250", "¥ 1,284", "£4 1,284": a rupee sign misread by OCR (sometimes with a stray
        # digit split off by a space), ending the line.
        m = re.search(r"(?:^|\s)[" + re.escape(RUPEE_SYMBOL_LOOKALIKES) + r"](?:\d\s)?\s?" + NUMBER + r"$", line)
        if m:
            add(4 + big + total, _to_cents(m.group(1), m.group(2)), m.group(0))
        # "Z 312", "Z1,200": ₹ read as the letter Z. Needs a space or money formatting,
        # because "Z139" on its own is a bank branch code.
        m = re.search(r"(?:^|\s)[zZ](?:\s" + NUMBER + r"|(\d{1,3}(?:,\d{2,3})+|\d+)\.(\d{2})"
                      r"|(\d{1,3}(?:,\d{2,3})+))$", line)
        if m:
            whole = m.group(1) or m.group(3) or m.group(5)
            frac = m.group(2) if m.group(1) else m.group(4)
            add(4 + big + total, _to_cents(whole, frac), m.group(0))
        # "T10,000": Google ML Kit's usual misread of a large ₹. Only glued to money
        # formatting, and flagged for the user to check, since T could be a real letter.
        m = re.search(r"(?:^|\s)T(\d{1,3}(?:,\d{2,3})+|\d+\.\d{2})$", line)
        if m:
            whole, _, frac = m.group(1).partition(".")
            if (cents := _to_cents(whole, frac or None)):
                corrected.add(cents)
                add(3 + big, cents, m.group(0))
        # A line that is only a number: the big headline amount when OCR dropped the ₹ sign.
        m = re.match(r"^" + NUMBER + r"$", line)
        if m and not re.fullmatch(r"(19|20)\d\d", m.group(1)):
            fixed = _rupee_read_as_digit(m.group(1)) if big else None
            if fixed:
                cents = _to_cents(fixed, m.group(2))
                corrected.add(cents)
                add(3, cents, line)
            elif big or re.search(r"paid|success|complete|sent|received|debited|credited|payment", near, re.I):
                add(3 + big, _to_cents(m.group(1), m.group(2)), line)
        # "Amount: 250.00", "Grand Total 472.50" — labelled numbers with money formatting.
        if (labelled or total) and not DATE_OR_TIME.search(line):
            for m in re.finditer(r"(?<![\w@])" + NUMBER + r"(?![\w@])", line):
                if (m.group(2) or "," in m.group(1)) and (cents := _to_cents(m.group(1), m.group(2))):
                    add(2 + total, cents, m.group(0))
        # A number ending a line after some text ("ads 500"): only trusted if it repeats.
        m = re.search(r"\S\s+" + NUMBER + r"$", line)
        if m and not DATE_OR_TIME.search(line):
            cents = _to_cents(m.group(1), m.group(2))
            if cents and not re.fullmatch(r"(19|20)\d\d", m.group(1)):
                line_end_values.append((cents, m.group(0)))
    # "Rupees Five Hundred Only"
    for m in AMOUNT_IN_WORDS.finditer("\n".join(lines)):
        value = words_to_number(m.group(1))
        if value:
            add(4, value * 100 if value * 100 <= MAX_AMOUNT_CENTS else None, m.group(0))
    counts = {}
    for cents, _ in line_end_values:
        counts[cents] = counts.get(cents, 0) + 1
    for cents, raw in line_end_values:
        if counts[cents] >= 2:
            add(3, cents, raw)

    if not candidates:
        return None, False
    candidates.sort(key=lambda c: (-c[0], c[1]))
    best = candidates[0]
    values = [c[2] for c in candidates]
    # "₹349" read as "3349": if the same number minus its first digit was also found,
    # the shorter one is the real amount.
    whole, paise = divmod(best[2], 100)
    digits = str(whole)
    if len(digits) > 1 and digits[0] in RUPEE_DIGIT_MISREADS:
        shorter = int(digits[1:]) * 100 + paise
        if shorter and shorter in values:
            return shorter, True
    if best[2] in corrected and values.count(best[2]) < 2:
        return best[2], False
    twins = {int(d + digits) * 100 + paise for d in RUPEE_DIGIT_MISREADS}
    confident = best[0] >= 4 or values.count(best[2]) >= 2 or bool(twins & set(values))
    return best[2], confident


def _safe_date(year, month, day, today):
    try:
        value = date(year, month, day)
    except ValueError:
        return None
    if value > today + timedelta(days=1) or value.year < 2000:
        return None
    return value


def find_date(lines, today):
    text = "\n".join(lines)
    patterns = [
        # Dates never span lines, so only spaces/dashes may separate the parts.
        (r"(?<![\d₹.,])\b(\d{1,2})(?:st|nd|rd|th)?[ \-]+" + MONTH_RE + r"(?![a-z])[ ,\-]*(\d{4})?(?!\d)", "dmy"),
        (r"\b" + MONTH_RE + r"(?![a-z]) +(\d{1,2})(?!\d)(?:st|nd|rd|th)?,? *(\d{4})?(?!\d)", "mdy"),
        (r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b", "iso"),
        (r"\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b", "numeric"),
    ]
    found = []
    for pattern, style in patterns:
        for m in re.finditer(pattern, text, re.I):
            g = m.groups()
            if style == "dmy":
                day, month, year = int(g[0]), MONTHS[g[1][:3].lower()], g[2]
            elif style == "mdy":
                month, day, year = MONTHS[g[0][:3].lower()], int(g[1]), g[2]
            elif style == "iso":
                year, month, day = g
            else:  # Indian order: dd/mm/yyyy
                day, month, year = int(g[0]), int(g[1]), g[2]
                if year and len(year) == 2:
                    year = "20" + year
            if year is None:
                # No year shown ("12 Sep, 10:30 pm"): this year, or last year if that's in the future.
                candidate = _safe_date(today.year, int(month), int(day), today)
                value = candidate or _safe_date(today.year - 1, int(month), int(day), today)
            else:
                value = _safe_date(int(year), int(month), int(day), today)
            if value:
                found.append((m.start(), value))
    if found:
        return min(found)[1]
    if re.search(r"\byesterday\b", text, re.I):
        return today - timedelta(days=1)
    if re.search(r"\btoday\b", text, re.I):
        return today
    return None


def find_reference(lines):
    text = "\n".join(lines)
    for pattern in REFERENCE_PATTERNS:
        m = pattern.search(text)
        if m:
            return m.group(1).replace(" ", "")[:40]  # OCR sometimes splits "4416342 52587"
    return None


TIME = re.compile(r"(?<![\w:])(\d{1,2}):(\d{2})(?![\d:])\s*([ap])?\.?\s*(m\b\.?)?", re.I)


def find_time(lines, today, day=None):
    """"HH:MM" (24-hour) of the payment, or None.

    When the payment's date (`day`) was found, only a time printed with that date
    (same line or the next) counts: chat screens show other messages' times too.
    Otherwise, the first time with am/pm: a bare time at the top of a screenshot is
    usually the phone's status-bar clock.
    """
    def parse(m):
        hour, minute = int(m.group(1)), int(m.group(2))
        meridiem = (m.group(3) or "").lower() if m.group(4) else ""
        if meridiem == "p" and hour < 12:
            hour += 12
        elif meridiem == "a" and hour == 12:
            hour = 0
        return f"{hour:02d}:{minute:02d}" if hour < 24 and minute < 60 else None

    if day:
        for i, line in enumerate(lines):
            if find_date([line], today) == day:
                for near in lines[i:i + 2]:
                    for m in TIME.finditer(near):
                        if (value := parse(m)):
                            return value
        return None
    for line in lines:
        for m in TIME.finditer(line):
            if m.group(4) and (value := parse(m)):
                return value
    return None


def clean_name(raw):
    name = re.sub(r"\b[\w.\-]+@[a-z][\w.\-]*\b", "", raw, flags=re.I).strip()  # drop UPI IDs
    if not name and "@" in raw:
        name = raw.split("@", 1)[0].replace(".", " ")
    name = re.sub(r"\s{2,}", " ", name).strip(" :-–·,.|")
    # OCR often puts the amount on the payee's line ("Blinkit £4 1,284"): drop trailing
    # tokens that are amounts or currency marks.
    tokens = name.split(" ")
    while len(tokens) > 1 and re.fullmatch(
            r"[₹" + re.escape(RUPEE_LOOKALIKES) + r"]?[\d,.]*\d[\d,.]*|[₹" + re.escape(RUPEE_LOOKALIKES) + r"]|rs\.?",
            tokens[-1], re.I):
        tokens.pop()
    name = " ".join(tokens)
    name = re.sub(r"^(?:mr|mrs|ms)\.?\s+", "", name, flags=re.I)
    name = re.sub(r"\s*\([^)]*\)?$", "", name)  # "Google Ads (gipl7t2pqrfd)", "X (Bank of Baroda)"
    if not name or NOT_A_NAME.match(name) or len(name) < 2:
        return None
    # Dates, times and number-heavy lines ("12 Sep 2026", "XXXX1234") aren't names.
    digits = sum(ch.isdigit() for ch in name)
    if (digits / len(name) > 0.3 or DATE_OR_TIME.search(name)
            or re.search(r"\d\s*" + MONTH_RE + r"(?![a-z])", name, re.I)):
        return None
    if name.isupper() and len(name) > 3:
        name = name.title()
    return name[:60]


def find_counterparty(lines, kind):
    """Who was paid (expense) or who paid you (income)."""
    line_pattern = PAYER_LINE if kind == "income" else PAYEE_LINE
    for i, line in enumerate(lines):
        m = line_pattern.match(line)
        if not m:
            continue
        name = clean_name(m.group(1))
        if not name:
            for nxt in lines[i + 1: i + 3]:
                name = clean_name(nxt)
                if name:
                    break
        if name:
            return name
    inline = INLINE_PAYER if kind == "income" else INLINE_PAYEE
    m = inline.search("\n".join(lines))
    if m:
        return clean_name(m.group(1))
    return None


def detect_kind(text):
    return detect_direction(text)[0]


def detect_direction(text):
    """(kind, confident). Only clear wording counts; with none, it's an unconfirmed expense."""
    income, expense = INCOME_HINTS.search(text), EXPENSE_HINTS.search(text)
    if income and not expense:
        return "income", True
    if expense and not income:
        return "expense", True
    if income and expense:
        # Both kinds of wording: the first one is the headline ("Received from …, credited to …").
        return ("income" if income.start() < expense.start() else "expense"), False
    return "expense", False


def detect_app(text):
    for name, pattern in APPS:
        if re.search(pattern, text, re.I):
            return name
    return None


def _contains(haystack, keyword):
    return re.search(r"(?<![a-z])" + re.escape(keyword.strip()) + r"(?![a-z])", haystack) is not None


def guess_category(kind, payee, text):
    table = INCOME_KEYWORDS if kind == "income" else CATEGORY_KEYWORDS
    valid = INCOME_CATEGORIES if kind == "income" else EXPENSE_CATEGORIES
    # The payee name is the strongest signal; fall back to the whole receipt.
    for haystack in filter(None, [(payee or "").lower(), text.lower()]):
        for category, keywords in table:
            if any(_contains(haystack, k) for k in keywords):
                return category if category in valid else "Other"
    return "Other"


# ------------------------------------------------------------------ #
# Entry points                                                        #
# ------------------------------------------------------------------ #

def parse_receipt_text(text, today):
    return parse_receipt_lines(normalise(text), today)


def parse_receipt_lines(items, today):
    """Parse OCR output given line by line.

    Each item is a string or {"text": ..., "height": ...}; the height (text size
    in pixels, as reported by the phone's OCR) helps spot the headline amount.
    """
    lines, heights = [], []
    for item in (items or [])[:2000]:
        raw, height = (item.get("text"), item.get("height")) if isinstance(item, dict) else (item, None)
        for line in normalise(str(raw or "")):
            lines.append(line)
            heights.append(height if isinstance(height, (int, float)) and 0 < height < 10_000 else None)
    joined = "\n".join(lines)
    kind, kind_confident = detect_direction(joined)
    receipt = Receipt(kind=kind, kind_confident=kind_confident, app=detect_app(joined))

    receipt.amount_cents, receipt.amount_confident = find_amount_with_confidence(lines, heights)
    day = find_date(lines, today)
    receipt.date = day.isoformat() if day else None
    receipt.time = find_time(lines, today, day)
    receipt.payee = find_counterparty(lines, receipt.kind)
    if not receipt.payee and TOTAL_LABELS.search(joined):
        # A shop bill: the shop's name is printed at the top.
        receipt.payee = next((name for name in map(clean_name, lines[:3]) if name), None)
    receipt.reference = find_reference(lines)
    receipt.category = guess_category(receipt.kind, receipt.payee, joined)

    for name in ("amount_cents", "date", "payee", "reference"):
        if getattr(receipt, name):
            receipt.found.add(name.replace("_cents", ""))
    if receipt.category != "Other":
        receipt.found.add("category")
    return receipt


def receipt_from_fields(data, today):
    """Build a Receipt from structured fields (e.g. an AI extractor's JSON).

    Every value is re-validated here, so a model can't smuggle in anything the
    text parser wouldn't accept.
    """
    from services.money import parse_amount

    receipt = Receipt()
    receipt.kind = "income" if str(data.get("type") or data.get("kind") or "").lower() == "income" else "expense"
    try:
        receipt.amount_cents = parse_amount(data.get("amount")) if data.get("amount") not in (None, "") else None
    except ValueError:
        receipt.amount_cents = None
    receipt.amount_confident = receipt.amount_cents is not None
    raw_date = str(data.get("date") or "")
    try:
        parsed = date.fromisoformat(raw_date[:10])
        receipt.date = parsed.isoformat() if _safe_date(parsed.year, parsed.month, parsed.day, today) else None
    except ValueError:
        receipt.date = None
    receipt.payee = clean_name(str(data.get("payee") or data.get("merchant") or "")) or None
    reference = re.sub(r"[^A-Za-z0-9]", "", str(data.get("reference") or ""))
    receipt.reference = reference[:40] or None
    valid = INCOME_CATEGORIES if receipt.kind == "income" else EXPENSE_CATEGORIES
    category = str(data.get("category") or "")
    receipt.category = category if category in valid else guess_category(receipt.kind, receipt.payee, "")
    receipt.app = str(data.get("app"))[:30] if data.get("app") else None
    for name in ("amount_cents", "date", "payee", "reference"):
        if getattr(receipt, name):
            receipt.found.add(name.replace("_cents", ""))
    if receipt.category != "Other":
        receipt.found.add("category")
    return receipt

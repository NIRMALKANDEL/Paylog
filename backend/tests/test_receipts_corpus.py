"""Receipt parser against OCR of real payment screenshots and bills.

fixtures/ocr_samples.json holds the OCR output (text and text height per line)
of public GPay / PhonePe / Paytm screenshots and two shop bills. Expected values
were read off the original images by hand. OCR mistakes are kept as they are:
"₹10,000" read as "210,000", "₹29" as "¥29", the ₹ dropped from "Paid ₹ 200".
"""

import json
from datetime import date
from pathlib import Path

import pytest

from services.receipts import parse_receipt_lines

TODAY = date(2026, 10, 10)
SAMPLES = json.loads((Path(__file__).parent / "fixtures" / "ocr_samples.json").read_text(encoding="utf-8"))

# name: (kind, amount_cents, date, payee, reference)   None = must not be guessed
EXPECTED = {
    # Paytm: headline "₹500" lost by OCR, but "Rupees Five Hundred Only" is there; ref split by a space.
    # (Payee not checked: OCR glued the Paytm logo to it as "payim"; the user edits that on review.)
    "s1": ("expense", 50000, "2024-02-19", None, "441634252587"),
    # GPay dark mode: OCR lost the headline amount entirely. Nothing else on screen shows it.
    "s2": ("expense", None, "2024-07-22", "Google India Pvt Ltd", "457016266549"),
    "s3": ("expense", 20000, "2020-10-16", "Google Ads", "029017679112"),
    # "Payment of ₹29 to Google Pay successful." — the amount only appears inside a sentence.
    "s4": ("expense", 2900, None, None, None),
    "s5": ("expense", 10000, "2020-03-13", "Google Play Recharge", "007310352874"),
    "s6": ("expense", 5000, "2020-02-29", "BharatpeMerchant", "006021191832"),
    # Paytm order: "received by Paytm" is money the user paid. A phone number and order number sit nearby.
    "s7": ("expense", 120000, "2019-09-19", None, "122337334207"),
    # GPay chat: "Payment to you ₹10,000" OCR'd as "210,000" — a credit.
    "s8": ("income", 1000000, "2026-05-09", None, None),
    # PhonePe: ₹ dropped on both "₹500" lines; balance-like account number next to it.
    "s9": ("expense", 50000, "2024-09-11", "ads", "742464784232"),
    # Photographed bill cut off before the total: there is no amount to read.
    "b1": ("expense", None, "2018-05-11", None, None),
    # Restaurant bill: Grand Total, not Subtotal, tax lines or "Paid Amount".
    "b2": ("expense", 47250, "2026-02-06", "Tasty Forks", None),
}


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_real_sample(name):
    kind, amount, day, payee, reference = EXPECTED[name]
    r = parse_receipt_lines(SAMPLES[name], TODAY)
    assert r.amount_cents == amount
    assert r.kind == kind
    assert r.date == day
    if payee is not None:
        assert r.payee == payee
    if reference is not None:
        assert r.reference == reference


@pytest.mark.parametrize("name", ["s2", "b1"])
def test_unreadable_amount_is_reported_not_invented(name):
    r = parse_receipt_lines(SAMPLES[name], TODAY)
    assert r.amount_cents is None
    assert "amount" in r.warnings


def test_misread_rupee_amount_is_flagged_for_review():
    # 210,000 -> 10,000 is a correction, so the user is asked to double-check it.
    r = parse_receipt_lines(SAMPLES["s8"], TODAY)
    assert "amount" in r.warnings


def test_times_are_read():
    assert parse_receipt_lines(SAMPLES["s3"], TODAY).time == "17:53"
    assert parse_receipt_lines(SAMPLES["s9"], TODAY).time == "19:45"
    assert parse_receipt_lines(SAMPLES["s5"], TODAY).time == "10:32"


# Google ML Kit output captured from the Android app (emulator), as the phone sends it:
# rows top to bottom with their text height. ML Kit misreads differ from the OCR above:
# "₹10,000" -> "T10,000", "₹500" -> "7500" / "75000".
MLKIT = json.loads((Path(__file__).parent / "fixtures" / "mlkit_samples.json").read_text(encoding="utf-8"))

MLKIT_EXPECTED = {
    "s2": ("expense", 50000, "2024-07-22", "Google India Pvt Ltd"),
    "s3": ("expense", 20000, "2020-10-16", "Google Ads"),
    "s4": ("expense", 2900, None, None),
    "s6": ("expense", 5000, "2020-02-29", "BharatpeMerchant"),
    "s7": ("expense", 120000, "2019-09-19", None),
    "s8": ("income", 1000000, "2026-05-09", None),
    # Both ₹500s misread differently (7500, 75000): no amount is better than a wrong one.
    "s9": ("expense", None, "2024-09-11", "ads"),
}


@pytest.mark.parametrize("name", sorted(MLKIT_EXPECTED))
def test_mlkit_sample(name):
    kind, amount, day, payee = MLKIT_EXPECTED[name]
    r = parse_receipt_lines(MLKIT[name], TODAY)
    assert (r.kind, r.amount_cents, r.date) == (kind, amount, day)
    if payee is not None:
        assert r.payee == payee


def test_mlkit_t_for_rupee_is_flagged():
    assert "amount" in parse_receipt_lines(MLKIT["s8"], TODAY).warnings


def test_your_registered_mobile_is_not_a_payee():
    assert parse_receipt_lines(MLKIT["s7"], TODAY).payee is None


def test_time_comes_from_the_payment_not_another_message():
    r = parse_receipt_lines(MLKIT["s8"], TODAY)
    assert r.date == "2026-05-09" and r.time is None  # "Yesterday, 11:18 pm" is a different message

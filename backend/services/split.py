"""Shared expenses (Splitwise-style): groups, who paid, who owes, settling up.

A group belongs to one Paylog account. Its members are just names (friends
don't need an account); one member is the account holder ("You"). Everything
is integer cents, and balances are always recomputed from the saved expenses,
shares and settlements, so they can't drift:

    net = paid for the group - own shares + settlements paid - settlements received

A positive net means the group owes that member; the nets always sum to zero.
Shared expenses are kept separate from personal transactions.
"""

from datetime import timedelta

from services.dates import MIN_DATE, parse_date, today
from services.money import cents_to_input, parse_amount

MAX_GROUPS = 50
MAX_MEMBERS = 30
MAX_NAME = 40
MAX_DESCRIPTION = 200
ME = "You"
SPLITS = ("equal", "exact")


# ------------------------------------------------------------------ #
# Reading                                                             #
# ------------------------------------------------------------------ #

def get_group(db, user_id, group_id):
    """The group if it belongs to this user, else None."""
    return db.execute("SELECT * FROM split_groups WHERE id = ? AND user_id = ?", (group_id, user_id)).fetchone()


def get_members(db, group_id):
    return db.execute("SELECT * FROM split_members WHERE group_id = ? ORDER BY is_me DESC, id", (group_id,)).fetchall()


def balances(db, group_id):
    """{member_id: net cents}. Positive: is owed money. Negative: owes money."""
    nets = {m["id"]: 0 for m in get_members(db, group_id)}
    queries = [
        ("SELECT paid_by AS m, SUM(amount_cents) AS v FROM split_expenses WHERE group_id = ? GROUP BY paid_by", 1),
        ("SELECT s.member_id AS m, SUM(s.share_cents) AS v FROM split_shares s"
         " JOIN split_expenses e ON e.id = s.expense_id WHERE e.group_id = ? GROUP BY s.member_id", -1),
        ("SELECT from_member AS m, SUM(amount_cents) AS v FROM split_settlements WHERE group_id = ? GROUP BY from_member", 1),
        ("SELECT to_member AS m, SUM(amount_cents) AS v FROM split_settlements WHERE group_id = ? GROUP BY to_member", -1),
    ]
    for sql, sign in queries:
        for row in db.execute(sql, (group_id,)):
            nets[row["m"]] = nets.get(row["m"], 0) + sign * row["v"]
    return nets


def suggest_settlements(nets):
    """Fewest-step plan to settle everyone: [(from_member, to_member, cents)].

    Greedy: the biggest debtor pays the biggest creditor, repeatedly. It needs at
    most (people - 1) payments and always settles every balance exactly.
    """
    debtors = sorted(([m, -n] for m, n in nets.items() if n < 0), key=lambda x: (-x[1], x[0]))
    creditors = sorted(([m, n] for m, n in nets.items() if n > 0), key=lambda x: (-x[1], x[0]))
    plan, i, j = [], 0, 0
    while i < len(debtors) and j < len(creditors):
        pay = min(debtors[i][1], creditors[j][1])
        plan.append((debtors[i][0], creditors[j][0], pay))
        debtors[i][1] -= pay
        creditors[j][1] -= pay
        if debtors[i][1] == 0:
            i += 1
        if creditors[j][1] == 0:
            j += 1
    return plan


def my_member(members):
    return next((m for m in members if m["is_me"]), None)


def list_groups(db, user_id):
    """Every group with its member count and the account holder's net balance."""
    out = []
    for group in db.execute("SELECT * FROM split_groups WHERE user_id = ? ORDER BY id DESC", (user_id,)):
        members = get_members(db, group["id"])
        me = my_member(members)
        nets = balances(db, group["id"])
        out.append({"group": group, "member_count": len(members), "my_net": nets.get(me["id"], 0) if me else 0})
    return out


def group_detail(db, group):
    """Members with balances, expenses with shares, settlements and a settle-up plan."""
    members = get_members(db, group["id"])
    names = {m["id"]: m["name"] for m in members}
    nets = balances(db, group["id"])
    me = my_member(members)
    shares = {}
    for row in db.execute(
        "SELECT s.* FROM split_shares s JOIN split_expenses e ON e.id = s.expense_id WHERE e.group_id = ?"
        " ORDER BY s.member_id", (group["id"],)
    ):
        shares.setdefault(row["expense_id"], []).append(
            {"member_id": row["member_id"], "name": names[row["member_id"]], "share_cents": row["share_cents"]})
    expenses = [
        {"expense": e, "paid_by_name": names[e["paid_by"]], "shares": shares.get(e["id"], []),
         "my_share": next((s["share_cents"] for s in shares.get(e["id"], []) if me and s["member_id"] == me["id"]), 0)}
        for e in db.execute("SELECT * FROM split_expenses WHERE group_id = ? ORDER BY date DESC, id DESC",
                            (group["id"],))
    ]
    settlements = [
        {"settlement": s, "from_name": names[s["from_member"]], "to_name": names[s["to_member"]]}
        for s in db.execute("SELECT * FROM split_settlements WHERE group_id = ? ORDER BY date DESC, id DESC",
                            (group["id"],))
    ]
    plan = [{"from_member": f, "from_name": names[f], "to_member": t, "to_name": names[t], "amount_cents": c}
            for f, t, c in suggest_settlements(nets)]
    return {
        "group": group,
        "members": [{"member": m, "net": nets.get(m["id"], 0)} for m in members],
        "me": me,
        "my_net": nets.get(me["id"], 0) if me else 0,
        "expenses": expenses,
        "settlements": settlements,
        "plan": plan,
        "total_spent": sum(e["expense"]["amount_cents"] for e in expenses),
    }


# ------------------------------------------------------------------ #
# Validation helpers                                                  #
# ------------------------------------------------------------------ #

def clean_name(raw):
    name = " ".join(str(raw or "").split())
    if not name:
        return None, "Enter a name."
    if len(name) > MAX_NAME:
        return None, f"Names can be at most {MAX_NAME} characters."
    return name, None


def _clean_date(raw):
    try:
        day = parse_date(raw)
    except ValueError as exc:
        return None, str(exc)
    if day < MIN_DATE or day > today() + timedelta(days=366):
        return None, "Date must be between 2000 and one year from today."
    return day.isoformat(), None


def _member_id(raw, members):
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if value in {m["id"] for m in members} else None


def _begin_write(db):
    # Take the write lock before reading balances, so two identical requests
    # (a double tap) can't both pass the checks.
    if not db.in_transaction:
        db.execute("BEGIN IMMEDIATE")


# ------------------------------------------------------------------ #
# Groups and members                                                  #
# ------------------------------------------------------------------ #

def create_group(db, user_id, name, member_names):
    """Returns (group_id, error). The account holder joins as "You"."""
    name, error = clean_name(name)
    if error:
        return None, "Group name: " + error[0].lower() + error[1:]
    people = []
    for raw in member_names:
        if not str(raw or "").strip():
            continue
        person, error = clean_name(raw)
        if error:
            return None, error
        if person.lower() in [p.lower() for p in people] + [ME.lower()]:
            return None, f"“{person}” is listed twice. Use different names (e.g. add an initial)."
        people.append(person)
    if not people:
        return None, "Add at least one other person to share with."
    if len(people) + 1 > MAX_MEMBERS:
        return None, f"A group can have up to {MAX_MEMBERS} people."
    if db.execute("SELECT COUNT(*) FROM split_groups WHERE user_id = ?", (user_id,)).fetchone()[0] >= MAX_GROUPS:
        return None, f"You can have up to {MAX_GROUPS} groups."
    group_id = db.execute("INSERT INTO split_groups (user_id, name) VALUES (?, ?)", (user_id, name)).lastrowid
    db.execute("INSERT INTO split_members (group_id, name, is_me) VALUES (?, ?, 1)", (group_id, ME))
    db.executemany("INSERT INTO split_members (group_id, name) VALUES (?, ?)", [(group_id, p) for p in people])
    db.commit()
    return group_id, None


def add_member(db, group, raw_name):
    name, error = clean_name(raw_name)
    if error:
        return None, error
    members = get_members(db, group["id"])
    if any(m["name"].lower() == name.lower() for m in members):
        return None, f"There's already someone called “{name}” in this group."
    if len(members) >= MAX_MEMBERS:
        return None, f"A group can have up to {MAX_MEMBERS} people."
    member_id = db.execute("INSERT INTO split_members (group_id, name) VALUES (?, ?)",
                           (group["id"], name)).lastrowid
    db.commit()
    return member_id, None


def remove_member(db, group, member_id):
    """Returns an error message, or None once removed."""
    member = next((m for m in get_members(db, group["id"]) if m["id"] == member_id), None)
    if member is None:
        return "That person isn't in this group."
    if member["is_me"]:
        return "You can't remove yourself from your own group."
    used = db.execute(
        "SELECT 1 FROM split_expenses WHERE group_id = ? AND paid_by = ?"
        " UNION SELECT 1 FROM split_shares s JOIN split_expenses e ON e.id = s.expense_id"
        "  WHERE e.group_id = ? AND s.member_id = ?"
        " UNION SELECT 1 FROM split_settlements WHERE group_id = ? AND ? IN (from_member, to_member) LIMIT 1",
        (group["id"], member_id, group["id"], member_id, group["id"], member_id),
    ).fetchone()
    if used:
        return f"{member['name']} is part of expenses or payments here. Delete those first to remove them."
    db.execute("DELETE FROM split_members WHERE id = ? AND group_id = ?", (member_id, group["id"]))
    db.commit()
    return None


def rename_group(db, group, raw_name):
    name, error = clean_name(raw_name)
    if error:
        return error
    db.execute("UPDATE split_groups SET name = ? WHERE id = ?", (name, group["id"]))
    db.commit()
    return None


def delete_group(db, group):
    db.execute("DELETE FROM split_groups WHERE id = ? AND user_id = ?", (group["id"], group["user_id"]))
    db.commit()


# ------------------------------------------------------------------ #
# Expenses                                                            #
# ------------------------------------------------------------------ #

def equal_shares(amount_cents, member_ids):
    """Split exactly: the leftover paise go one each to the first members listed."""
    base, extra = divmod(amount_cents, len(member_ids))
    return {m: base + (1 if i < extra else 0) for i, m in enumerate(member_ids)}


def add_expense(db, group, paid_by, amount, description, day, split, member_ids=(), shares=None):
    """Save a shared expense. Returns (expense_id, error).

    split "equal": `member_ids` share it equally.
    split "exact": `shares` maps member id -> amount text; they must add up to the total.
    """
    members = get_members(db, group["id"])
    payer = _member_id(paid_by, members)
    if payer is None:
        return None, "Choose who paid."
    try:
        total = parse_amount(amount)
    except ValueError as exc:
        return None, str(exc)
    description = " ".join(str(description or "").split())
    if len(description) > MAX_DESCRIPTION:
        return None, f"Description must be at most {MAX_DESCRIPTION} characters."
    date_iso, error = _clean_date(day)
    if error:
        return None, error
    if split not in SPLITS:
        return None, "Choose how to split it: equally or by exact amounts."

    if split == "equal":
        chosen = []
        for raw in member_ids or []:
            member = _member_id(raw, members)
            if member is None:
                return None, "Someone in the split isn't in this group."
            if member not in chosen:
                chosen.append(member)
        if not chosen:
            return None, "Choose who shares this expense."
        if total < len(chosen):
            return None, "The amount is too small to split between that many people."
        portions = equal_shares(total, chosen)
    else:
        portions = {}
        for raw_id, raw_amount in (shares or {}).items():
            member = _member_id(raw_id, members)
            if member is None:
                return None, "Someone in the split isn't in this group."
            if str(raw_amount if raw_amount is not None else "").strip() in ("", "0"):
                continue
            try:
                cents = parse_amount(raw_amount, allow_zero=True)
            except ValueError as exc:
                return None, f"{next(m['name'] for m in members if m['id'] == member)}'s share: {exc}"
            if cents:
                portions[member] = portions.get(member, 0) + cents
        if not portions:
            return None, "Enter how much each person's share is."
        if sum(portions.values()) != total:
            return None, (f"The shares add up to {cents_to_input(sum(portions.values()))}, "
                          f"but the expense is {cents_to_input(total)}.")
    if set(portions) == {payer}:
        return None, "Only the person who paid is in the split, so nobody owes anything. Add others."

    expense_id = db.execute(
        "INSERT INTO split_expenses (group_id, paid_by, amount_cents, description, date, split)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (group["id"], payer, total, description, date_iso, split),
    ).lastrowid
    db.executemany("INSERT INTO split_shares (expense_id, member_id, share_cents) VALUES (?, ?, ?)",
                   [(expense_id, m, c) for m, c in portions.items()])
    db.commit()
    return expense_id, None


def delete_expense(db, group, expense_id):
    deleted = db.execute("DELETE FROM split_expenses WHERE id = ? AND group_id = ?",
                         (expense_id, group["id"])).rowcount
    db.commit()
    return bool(deleted)


# ------------------------------------------------------------------ #
# Settling up                                                         #
# ------------------------------------------------------------------ #

def record_settlement(db, group, from_member, to_member, amount, day):
    """Someone paid someone back. Returns (settlement_id, error).

    Only what is actually owed can be recorded: the payer must owe money, the
    receiver must be owed money, and the amount can't exceed either. So the same
    payment saved twice (a double tap, a resent form) is refused the second time.
    """
    try:
        cents = parse_amount(amount)
    except ValueError as exc:
        return None, str(exc)
    date_iso, error = _clean_date(day)
    if error:
        return None, error
    _begin_write(db)
    try:
        members = get_members(db, group["id"])
        payer, receiver = _member_id(from_member, members), _member_id(to_member, members)
        if payer is None or receiver is None:
            raise _Refused("Choose who paid and who received the money.")
        if payer == receiver:
            raise _Refused("Choose two different people.")
        nets = balances(db, group["id"])
        names = {m["id"]: m["name"] for m in members}
        me = {m["id"] for m in members if m["is_me"]}
        owes, owed = -nets.get(payer, 0), nets.get(receiver, 0)
        if owes <= 0:
            raise _Refused("You don't owe anything in this group." if payer in me
                           else f"{names[payer]} doesn't owe anything in this group.")
        if owed <= 0:
            raise _Refused("You aren't owed anything in this group." if receiver in me
                           else f"{names[receiver]} isn't owed anything in this group.")
        if cents > min(owes, owed):
            raise _Refused(f"That's more than is owed: at most {cents_to_input(min(owes, owed))} "
                           f"can go from {names[payer]} to {names[receiver]}.")
        settlement_id = db.execute(
            "INSERT INTO split_settlements (group_id, from_member, to_member, amount_cents, date)"
            " VALUES (?, ?, ?, ?, ?)",
            (group["id"], payer, receiver, cents, date_iso),
        ).lastrowid
        db.commit()
        return settlement_id, None
    except _Refused as refused:
        db.rollback()
        return None, str(refused)


class _Refused(Exception):
    pass


def delete_settlement(db, group, settlement_id):
    deleted = db.execute("DELETE FROM split_settlements WHERE id = ? AND group_id = ?",
                         (settlement_id, group["id"])).rowcount
    db.commit()
    return bool(deleted)

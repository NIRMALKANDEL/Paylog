"""Materialise due recurring rules into real transactions."""

from services.dates import add_months, parse_date, timedelta

# Safety valve: a weekly rule left untouched for years should not insert
# thousands of rows in a single request.
MAX_OCCURRENCES_PER_RUN = 200


def advance(current, frequency, anchor_day):
    if frequency == "weekly":
        return current + timedelta(days=7)
    if frequency == "monthly":
        return add_months(current, 1, anchor_day)
    if frequency == "yearly":
        return add_months(current, 12, anchor_day)
    raise ValueError(f"Unknown frequency: {frequency}")


def run_due(db, user_id, today):
    """Insert every occurrence due on or before `today`. Returns rows created.

    Safe to run from several requests at once (the app and its widget often load
    together): each rule is claimed by moving its next_date forward only if it
    still holds the value read here, so only one request inserts a given occurrence.
    """
    rules = db.execute(
        "SELECT * FROM recurring WHERE user_id = ? AND active = 1 AND next_date <= ?",
        (user_id, today.isoformat()),
    ).fetchall()
    created = 0
    for rule in rules:
        due = parse_date(rule["next_date"])
        dates = []
        while due <= today and len(dates) < MAX_OCCURRENCES_PER_RUN:
            dates.append(due)
            due = advance(due, rule["frequency"], rule["anchor_day"])
        claimed = db.execute(
            "UPDATE recurring SET next_date = ? WHERE id = ? AND next_date = ? AND active = 1",
            (due.isoformat(), rule["id"], rule["next_date"]),
        ).rowcount
        if not claimed:
            continue  # another request already added these occurrences
        db.executemany(
            "INSERT INTO transactions (user_id, kind, amount_cents, category, date, description, recurring_id)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(user_id, rule["kind"], rule["amount_cents"], rule["category"], day.isoformat(),
              rule["description"], rule["id"]) for day in dates],
        )
        created += len(dates)
    if rules:
        db.commit()
    return created


def upcoming(db, user_id, today, days=7):
    """Active rules due within the next `days` days (after today), soonest first."""
    return db.execute(
        "SELECT * FROM recurring WHERE user_id = ? AND active = 1 AND next_date > ? AND next_date <= ?"
        " ORDER BY next_date, id",
        (user_id, today.isoformat(), (today + timedelta(days=days)).isoformat()),
    ).fetchall()

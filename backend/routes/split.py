"""Shared expenses pages (Splitwise-style). The logic lives in services/split.py."""

from flask import Blueprint, abort, flash, g, redirect, render_template, request, url_for

from database.db import get_db
from services import split
from services.dates import today
from services.security import login_required

bp = Blueprint("split", __name__, url_prefix="/shared")


def owned_group(group_id):
    group = split.get_group(get_db(), g.user["id"], group_id)
    if group is None:
        abort(404)
    return group


def back_to(group_id, anchor=""):
    return redirect(url_for("split.group", group_id=group_id) + anchor)


@bp.route("/", methods=["GET", "POST"])
@login_required
def index():
    db = get_db()
    form, error = {}, None
    if request.method == "POST":
        form = request.form
        names = request.form.get("members", "").replace(",", "\n").split("\n")
        group_id, error = split.create_group(db, g.user["id"], request.form.get("name"), names)
        if not error:
            flash("Group created. Add the first expense below.", "success")
            return back_to(group_id)
    groups = split.list_groups(db, g.user["id"])
    return render_template("split/index.html", groups=groups, form=form, error=error), (400 if error else 200)


@bp.route("/<int:group_id>")
@login_required
def group(group_id):
    detail = split.group_detail(get_db(), owned_group(group_id))
    return render_template("split/group.html", d=detail, today=today().isoformat())


@bp.route("/<int:group_id>/rename", methods=["POST"])
@login_required
def rename(group_id):
    error = split.rename_group(get_db(), owned_group(group_id), request.form.get("name"))
    flash(error or "Group renamed.", "error" if error else "success")
    return back_to(group_id, "#people")


@bp.route("/<int:group_id>/delete", methods=["POST"])
@login_required
def delete(group_id):
    split.delete_group(get_db(), owned_group(group_id))
    flash("Group deleted.", "success")
    return redirect(url_for("split.index"))


@bp.route("/<int:group_id>/members", methods=["POST"])
@login_required
def add_member(group_id):
    _, error = split.add_member(get_db(), owned_group(group_id), request.form.get("name"))
    flash(error or "Added to the group.", "error" if error else "success")
    return back_to(group_id, "#people")


@bp.route("/<int:group_id>/members/<int:member_id>/delete", methods=["POST"])
@login_required
def remove_member(group_id, member_id):
    error = split.remove_member(get_db(), owned_group(group_id), member_id)
    flash(error or "Removed from the group.", "error" if error else "success")
    return back_to(group_id, "#people")


@bp.route("/<int:group_id>/expenses", methods=["POST"])
@login_required
def add_expense(group_id):
    grp = owned_group(group_id)
    f = request.form
    shares = {key[len("share_"):]: value for key, value in f.items() if key.startswith("share_")}
    _, error = split.add_expense(get_db(), grp, f.get("paid_by"), f.get("amount"), f.get("description"),
                                 f.get("date"), f.get("split"), f.getlist("members"), shares)
    flash(error or "Expense added.", "error" if error else "success")
    return back_to(group_id, "#add-expense" if error else "")


@bp.route("/<int:group_id>/expenses/<int:expense_id>/delete", methods=["POST"])
@login_required
def delete_expense(group_id, expense_id):
    if not split.delete_expense(get_db(), owned_group(group_id), expense_id):
        abort(404)
    flash("Expense deleted.", "success")
    return back_to(group_id)


@bp.route("/<int:group_id>/settlements", methods=["POST"])
@login_required
def settle(group_id):
    f = request.form
    _, error = split.record_settlement(get_db(), owned_group(group_id), f.get("from_member"), f.get("to_member"),
                                       f.get("amount"), f.get("date") or today().isoformat())
    flash(error or "Payment recorded.", "error" if error else "success")
    return back_to(group_id, "#settle")


@bp.route("/<int:group_id>/settlements/<int:settlement_id>/delete", methods=["POST"])
@login_required
def delete_settlement(group_id, settlement_id):
    if not split.delete_settlement(get_db(), owned_group(group_id), settlement_id):
        abort(404)
    flash("Payment removed.", "success")
    return back_to(group_id, "#settle")

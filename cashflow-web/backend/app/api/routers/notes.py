"""
app/api/routers/notes.py
==========================
CRUD for Notes (free-text annotations on any entity).

Endpoints (all auth-protected):
  GET    /api/notes?target_type=&target_key=   → list, newest first (filter optional)
  POST   /api/notes                            → create (audit create_note)
  DELETE /api/notes/{id}                       → delete (audit delete_note; 404 if missing)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.audit import record_audit, to_audit_dict
from app.api.deps import get_current_user, get_session
from app.api.errors import ApiError
from app.api.schemas import NoteCreate, NoteOut
from app.db.models import Note

router = APIRouter(prefix="/api/notes", tags=["notes"])


# ---------------------------------------------------------------------------
# GET /api/notes
# ---------------------------------------------------------------------------

@router.get("", response_model=list[NoteOut])
def list_notes(
    target_type: str | None = Query(default=None),
    target_key: str | None = Query(default=None),
    db: Session = Depends(get_session),
    _user=Depends(get_current_user),
) -> list[NoteOut]:
    q = db.query(Note)
    if target_type is not None:
        q = q.filter(Note.target_type == target_type)
    if target_key is not None:
        q = q.filter(Note.target_key == target_key)
    rows = q.order_by(Note.created_at.desc()).all()
    return [
        NoteOut(
            id=n.id,
            target_type=n.target_type,
            target_key=n.target_key,
            body=n.body,
            created_by=n.created_by,
            created_at=n.created_at,
        )
        for n in rows
    ]


# ---------------------------------------------------------------------------
# POST /api/notes
# ---------------------------------------------------------------------------

@router.post("", response_model=NoteOut, status_code=201)
def create_note(
    body: NoteCreate,
    db: Session = Depends(get_session),
    user=Depends(get_current_user),
) -> NoteOut:
    note = Note(
        target_type=body.target_type,
        target_key=body.target_key,
        body=body.body,
        created_by=user.id,
    )
    db.add(note)
    db.flush()  # get note.id

    record_audit(
        db, user,
        action="create_note",
        entity="note",
        entity_id=note.id,
        before=None,
        after=to_audit_dict(note),
    )
    db.commit()
    db.refresh(note)

    return NoteOut(
        id=note.id,
        target_type=note.target_type,
        target_key=note.target_key,
        body=note.body,
        created_by=note.created_by,
        created_at=note.created_at,
    )


# ---------------------------------------------------------------------------
# DELETE /api/notes/{id}
# ---------------------------------------------------------------------------

@router.delete("/{note_id}")
def delete_note(
    note_id: int,
    db: Session = Depends(get_session),
    user=Depends(get_current_user),
) -> dict:
    note: Note | None = db.query(Note).filter(Note.id == note_id).first()
    if note is None:
        raise ApiError("not_found", f"الملاحظة {note_id} غير موجودة", 404)

    before_dict = to_audit_dict(note)
    db.delete(note)

    record_audit(
        db, user,
        action="delete_note",
        entity="note",
        entity_id=note_id,
        before=before_dict,
        after=None,
    )
    db.commit()

    return {"deleted": note_id}

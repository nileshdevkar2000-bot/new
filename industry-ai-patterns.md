# NEO industry AI patterns

This file records design patterns for NEO based on public product documentation and is not a reproduction of third-party proprietary content.

## Quality / QMS
- Connect incidents, deviations, CAPA, document control, audit, training and supplier quality into one contextual workflow.
- AI should prepare recommendations and workflow drafts while the accountable person approves regulated actions.
- Keep permissions, audit trails, version control and source references close to every AI-assisted action.

## Clinical Trial
- Maintain a study-centric intelligence layer spanning feasibility, site performance, startup, protocol execution, data review and closeout.
- Provide an assistant that can answer against study context and internal institutional knowledge instead of resetting context on each question.
- Support evidence-based site and study intelligence while defaulting to de-identified/authorized data for sensitive workflows.

## Pharmacovigilance
- Connect safety intake, case triage, narrative support, signal detection, literature review, aggregate reporting and regulatory workflows.
- Provide a conversational safety assistant, but keep case-level data permission-scoped and require human review for safety decisions and submissions.
- Bridge safety data with Clinical, Quality, Regulatory, Medical Affairs and Complaint Handling.

## Enterprise agent pattern
- One assistant, multiple domain tools, one identity and one audit context.
- Let the agent invoke approved tools for internal knowledge and external search instead of granting the model unrestricted database access.
- Support voice interruption, live transcription, spoken output and resumable sessions for hands-free work.

## Privacy pattern
- Minimize patient-identifying data.
- Use de-identified or aggregated data where possible.
- Make data residency, retention, provider boundaries, role/department scoping and human approval explicit.

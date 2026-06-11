# Skylight Project Context

## Purpose

Skylight is a self-hosted aircraft/ADS-B visualization and tracking project managed through Paperclip and GitHub.

## Source of Truth

* Paperclip: planning, tasks, delegation, governance, and decisions.
* GitHub: code, branches, commits, pull requests, and technical review.

## Runtime Context

The production/runtime environment is the NAS/Portainer stack.

Known infrastructure context:

* NAS host: 192.168.31.5
* Deployment style: Docker / Portainer
* Reverse proxy may be managed through Nginx Proxy Manager or Cloudflare.
* Changes must be safe for a self-hosted environment.

## Engineering Rules

Agents must not commit directly to main.

All code changes should use:

1. Paperclip issue
2. GitHub branch
3. Pull request
4. Review
5. Human-approved merge when needed

## Pull Request Requirements

Every PR must include:

* Summary
* Linked Paperclip issue
* Files changed
* Test plan
* Rollback notes
* Deployment impact

## Review Rules

* Principal Engineer reviews architecture and code quality.
* QA reviews behavior against acceptance criteria.
* DevOps reviews deployment/runtime changes.
* CTO gives final technical approval.
* CEO/human operator approves production-impacting changes.

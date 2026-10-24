"""Read-only review gate. Execute the trusted base version in Actions, never a PR override."""

import argparse
import json
import subprocess

p = argparse.ArgumentParser()
p.add_argument("--repository", required=True)
p.add_argument("--number", type=int, required=True)
p.add_argument("--base-ref", required=True)
p.add_argument("--boundary", action="store_true")
a = p.parse_args()
policy = json.loads(
    subprocess.check_output(
        ["git", "show", a.base_ref + ":.github/maintainers.json"], text=True
    )
)
pr = json.loads(
    subprocess.check_output(
        ["gh", "api", f"repos/{a.repository}/pulls/{a.number}"], text=True
    )
)
reviews = json.loads(
    subprocess.check_output(
        [
            "gh",
            "api",
            "--paginate",
            "--slurp",
            f"repos/{a.repository}/pulls/{a.number}/reviews?per_page=100",
        ],
        text=True,
    )
)
latest = {}
for page in reviews:
    for review in page:
        login = review["user"]["login"]
        if login in policy["users"] and review["state"] in [
            "APPROVED",
            "CHANGES_REQUESTED",
            "DISMISSED",
        ]:
            latest[login] = review
valid = [
    login
    for login, review in latest.items()
    if review["state"] == "APPROVED"
    and review["commit_id"] == pr["head"]["sha"]
    and login != pr["user"]["login"]
]
required = policy["boundaryApprovals"] if a.boundary else policy["ordinaryApprovals"]
if len(valid) < required:
    raise SystemExit(
        f'Review required: {len(valid)}/{required} configured non-author maintainers approved the exact head. Boundary proposals need a second eligible maintainer; current policy has {len(policy["users"])}.'
    )
print("Approved by configured maintainers at exact PR head: " + ", ".join(valid))

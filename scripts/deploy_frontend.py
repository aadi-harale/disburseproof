"""Build the frontend against the deployed API and publish it to Amplify Hosting.

Usage (after `sam deploy`):
    python scripts/deploy_frontend.py [--stack disburseproof-dev] [--region ap-south-1] [--skip-build]

Steps:
  1. Read ApiUrl and AmplifyAppId from the CloudFormation stack outputs.
  2. `npm ci` and `npm run build` in frontend/ with VITE_API_URL set to ApiUrl.
  3. Render security headers (CSP with the exact API origin, HSTS, ...) into
     dist/customHttp.yml, which Amplify applies to manual deployments.
  4. Zip frontend/dist and publish it as a manual Amplify deployment
     (create-deployment -> upload the zip -> start-deployment), then wait for it.

Uses your normal AWS credentials (profile or environment). Nothing is stored.
"""

from __future__ import annotations

import argparse
import io
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
BRANCH = "main"


def stack_outputs(stack: str, region: str) -> dict[str, str]:
    stacks = boto3.client("cloudformation", region_name=region).describe_stacks(StackName=stack)["Stacks"]
    return {output["OutputKey"]: output["OutputValue"] for output in stacks[0].get("Outputs", [])}


def build(api_url: str) -> None:
    env = {**os.environ, "VITE_API_URL": api_url}
    npm = "npm.cmd" if os.name == "nt" else "npm"
    for args in ([npm, "ci"], [npm, "run", "build"]):
        print(f"$ {' '.join(args)}  (VITE_API_URL={api_url})")
        subprocess.run(args, cwd=FRONTEND, env=env, check=True)


def write_security_headers(api_url: str) -> None:
    """Render frontend/security-headers.yml into dist/customHttp.yml with the API origin.

    Amplify applies customHttp.yml from the root of a manual deployment. The CSP's
    connect-src must name the exact API origin, which only exists after sam deploy.
    """
    parsed = urllib.parse.urlsplit(api_url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise SystemExit(f"Refusing to build a CSP for a non-HTTPS API URL: {api_url}")
    origin = f"https://{parsed.hostname}"
    template = (FRONTEND / "security-headers.yml").read_text(encoding="utf-8")
    if "__API_ORIGIN__" not in template:
        raise SystemExit("security-headers.yml has no __API_ORIGIN__ placeholder")
    (FRONTEND / "dist" / "customHttp.yml").write_text(template.replace("__API_ORIGIN__", origin), encoding="utf-8")
    print(f"Security headers written (connect-src 'self' {origin})")


def zip_dist() -> bytes:
    dist = FRONTEND / "dist"
    if not (dist / "index.html").exists():
        raise SystemExit("frontend/dist/index.html not found; build the frontend first")
    if not (dist / "customHttp.yml").exists():
        raise SystemExit("dist/customHttp.yml missing: security headers were not rendered")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(dist.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(dist).as_posix())  # index.html at the zip root
    return buffer.getvalue()


def publish(app_id: str, region: str, payload: bytes) -> None:
    amplify = boto3.client("amplify", region_name=region)
    deployment = amplify.create_deployment(appId=app_id, branchName=BRANCH)
    request = urllib.request.Request(
        deployment["zipUploadUrl"], data=payload, method="PUT", headers={"Content-Type": "application/zip"}
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status >= 300:
            raise SystemExit(f"Zip upload failed with HTTP {response.status}")
    job_id = deployment["jobId"]
    amplify.start_deployment(appId=app_id, branchName=BRANCH, jobId=job_id)
    print(f"Amplify job {job_id} started", end="", flush=True)
    for _ in range(90):
        status = amplify.get_job(appId=app_id, branchName=BRANCH, jobId=job_id)["job"]["summary"]["status"]
        if status in ("SUCCEED", "FAILED", "CANCELLED"):
            print(f" -> {status}")
            if status != "SUCCEED":
                raise SystemExit("Amplify deployment did not succeed; check the Amplify console")
            return
        print(".", end="", flush=True)
        time.sleep(2)
    raise SystemExit("Timed out waiting for the Amplify deployment")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stack", default="disburseproof-dev")
    parser.add_argument("--region", default="ap-south-1")
    parser.add_argument("--skip-build", action="store_true")
    args = parser.parse_args()

    outputs = stack_outputs(args.stack, args.region)
    if not args.skip_build:
        build(outputs["ApiUrl"])
    write_security_headers(outputs["ApiUrl"])
    payload = zip_dist()
    print(f"Publishing {len(payload) / 1024:.0f} KB to Amplify app {outputs['AmplifyAppId']}")
    publish(outputs["AmplifyAppId"], args.region, payload)
    print(f"Live at {outputs['FrontendUrl']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

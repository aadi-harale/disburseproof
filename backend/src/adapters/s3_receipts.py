"""S3 access for integrity receipts.

Owns: writing and reading `receipts/<run_id>.json`. The upload carries our own
SHA-256 as `ChecksumSHA256`, so S3 verifies the bytes it stored are the bytes we
hashed, and the checksum S3 keeps matches the `receipt_sha256` on the run.
Must never: build receipts (domain/receipt.py does).
"""

from __future__ import annotations

import base64
import hashlib
from functools import cache
from typing import Any

import boto3


@cache
def s3_client() -> Any:
    return boto3.client("s3")


class S3Receipts:
    def __init__(self, bucket: str, client: Any | None = None) -> None:
        self._bucket = bucket
        self._client = client or s3_client()

    def put(self, key: str, body: bytes) -> str:
        """Store the receipt and return its SHA-256 (hex)."""
        digest = hashlib.sha256(body).digest()
        self._client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=body,
            ContentType="application/json; charset=utf-8",
            ChecksumSHA256=base64.b64encode(digest).decode("ascii"),
        )
        return digest.hex()

    def get(self, key: str) -> bytes:
        response = self._client.get_object(Bucket=self._bucket, Key=key)
        body: bytes = response["Body"].read()
        return body

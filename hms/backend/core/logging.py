"""Application logging configuration."""

import logging
import sys


def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s [%(name)s] %(message)s",
        stream=sys.stdout,
        force=True,
    )
    # The libraries below are chatty at INFO.
    for noisy in ("httpcore", "httpx", "multipart", "multipart.multipart"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

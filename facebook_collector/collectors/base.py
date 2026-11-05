from dataclasses import dataclass
from typing import Protocol, Iterator


@dataclass
class Page:
    posts: list[dict]
    has_next: bool | None
    cursor: str | None
    continuation_supported: bool = True


class Collector(Protocol):
    def get_group_info(self, group_id: str) -> dict: ...
    def pages(self, group_id: str) -> Iterator[Page]: ...
    def close(self) -> None: ...

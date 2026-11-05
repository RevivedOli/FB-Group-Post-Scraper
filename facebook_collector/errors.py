"""Safe public errors: never include upstream exception bodies or credentials."""


class CollectorError(Exception):
    def __init__(self, code, message, details=None):
        self.code = code
        self.details = details or {}
        super().__init__(message)


def fail(code, message):
    raise CollectorError(code, message)

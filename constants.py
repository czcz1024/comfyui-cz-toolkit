NODE_ID_PREFIX = "Cz"


def node_id(stem: str) -> str:
    return f"{NODE_ID_PREFIX}{stem}"

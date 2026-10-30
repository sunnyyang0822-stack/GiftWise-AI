"""首先粘贴到真实 Dify Python Code 节点运行；不调用模型或网络。"""


def main() -> dict:
    import json
    import re
    import unicodedata
    from decimal import Decimal, InvalidOperation

    # 任一 import 失败时节点应直接失败，不能标记兼容成功。
    assert Decimal("0.1") + Decimal("0.2") == Decimal("0.3")
    assert unicodedata.normalize("NFKC", "ＡＬＣＯＨＯＬ").casefold() == "alcohol"
    assert re.fullmatch(r"(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?", "200.00", re.ASCII)
    assert json.loads('{"days":2}')["days"] == 2
    assert isinstance(InvalidOperation(), Exception)
    return {"compatible": True, "details_json": json.dumps({"json": True, "re_ascii": True, "unicodedata_nfkc": True, "decimal": True, "mode": "stdlib_probe_only"})}

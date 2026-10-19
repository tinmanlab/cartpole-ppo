"""Build the standalone CartPole controller × observer educational lab."""
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parent

def read(name):
    return (ROOT/name).read_text(encoding="utf-8")

def build():
    shell=read("control_lab_shell.html")
    robust=json.loads(read("example_robust.json"))
    actor=robust["records"][-1]["policy"]["actor"]
    residual_path=REPO/"artifacts"/"control_observer_residual.json"
    residual=json.loads(residual_path.read_text(encoding="utf-8")) if residual_path.exists() else None
    parts={
        "STYLE":read("control_lab.css"),
        "CORE":"\n".join([read("bam_params.js"),read("plant.js"),read("control_lab_engine.js")]),
        "ACTOR":"const CONTROL_LAB_ACTOR = "+json.dumps(actor,separators=(",",":"))+";",
        "RESIDUAL":"const CONTROL_LAB_RESIDUAL = "+json.dumps(residual,separators=(",",":"))+";",
        "APP":read("control_lab_app.js"),
    }
    for key,value in parts.items():
        token=f"/* {key} */"
        if shell.count(token)!=1:
            raise ValueError(f"expected one {token}")
        shell=shell.replace(token,value)
    return shell

if __name__=="__main__":
    out=REPO/"control-observer-lab.html"
    out.write_text(build(),encoding="utf-8")
    print(f"{out.name}: {out.stat().st_size:,} bytes")

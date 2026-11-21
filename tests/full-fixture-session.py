"""Keep a real RPM synthetic registry alive for packed candidate acceptance."""
import json
from pathlib import Path
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "rpm-integration" / "tests"))
from fixture import Fixture, SOURCE_A  # noqa: E402

parent, skill, destination = map(Path, sys.argv[1:4])
with tempfile.TemporaryDirectory(prefix="rpm-interface-", dir=parent) as location:
    fixture = Fixture(location, skill, root / "rpm-integration" / "rpm_knowledge_api.py")
    fixture.seed()
    projects = [
        {"id": "fixture-estuary", "name": "合成河口项目", "rpmRoot": str(fixture.projects["a"]),
         "rpmProjectId": fixture.ids["a"], "stage": "初始阶段"},
        {"id": "fixture-camera", "name": "合成相机项目", "rpmRoot": str(fixture.projects["b"]),
         "rpmProjectId": fixture.ids["b"], "stage": "校准阶段"},
        {"id": "fixture-unbound", "name": "合成未登记项目"}
    ]
    data = {"projects": projects, "tasks": [
        {"id": "fixture-task", "p": "fixture-estuary", "t": "合成复核任务",
         "st": "review", "pri": "hi", "due": ""}
    ]}
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise FileExistsError(destination)
    destination.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"settings": str(fixture.settings), "projectId": fixture.ids["a"],
                      "original": str(fixture.file("a", SOURCE_A)), "relative": SOURCE_A}),
          flush=True)
    for item in sys.stdin:
        command = item.strip()
        if command == "advance":
            fixture.update()
            print("updated", flush=True)
        elif command == "quit":
            break

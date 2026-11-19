"""Group Node test cases by file for Azure's JUnit importer."""

from pathlib import Path
from sys import argv
from xml.etree import ElementTree as ET


def normalize(path: Path) -> None:
    report = ET.parse(path)
    result = ET.Element("testsuites")
    suites: dict[str, ET.Element] = {}
    for case in report.iter("testcase"):
        name = case.get("file") or path.stem
        if name not in suites:
            suites[name] = ET.SubElement(result, "testsuite", name=name)
        case.set("classname", name)
        suites[name].append(case)
    if not suites:
        raise ValueError(f"No test cases in {path}")
    for suite in suites.values():
        suite.set("tests", str(len(suite)))
        for tag, attribute in (("failure", "failures"), ("error", "errors"), ("skipped", "skipped")):
            suite.set(attribute, str(sum(case.find(tag) is not None for case in suite)))
    ET.ElementTree(result).write(path, encoding="utf-8", xml_declaration=True)
    print(f"{path}: {sum(len(suite) for suite in suites.values())} test cases")


if __name__ == "__main__":
    for file in map(Path, argv[1:]):
        if file.is_file():
            normalize(file)

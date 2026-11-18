#!/usr/bin/env python3
"""Build scan/catalogue.json for the inbox scanner from the private organisation database.

The full database (how to change your name at each organisation, proof rules,
sources) is private and is NOT in this repo. This script copies only what the
scanner needs to recognise senders: id, name, category, phase and sender domains.

Usage:
  python3 scan/tools/build_catalogue.py /path/to/organisations.json /path/to/categories.json [--sample]

--sample keeps a short list of well-known organisations (the default until the
full list is approved for publishing).
"""
import json
import sys
from datetime import date
from pathlib import Path

# Domains too broad to say anything about one organisation.
BLOCKED = {
    "gov.uk", "service.gov.uk", "ac.uk", "nhs.uk", "nhs.net", "nhs.scot", "gov.scot", "gov.wales",
    "moneyhelper.org.uk", "abi.org.uk", "gmail.com", "googlemail.com", "outlook.com",
    "hotmail.com", "yahoo.com", "icloud.com",
}

# Friendly names for domains that several organisations share.
GROUP_LABELS = {
    "dvla.gov.uk": "DVLA",
    "hmrc.gov.uk": "HMRC",
    "dwp.gov.uk": "DWP (benefits and State Pension)",
    "nhsbsa.nhs.uk": "NHS Business Services Authority",
    "nhsbt.nhs.uk": "NHS Blood and Transplant",
    "veterans-uk.mod.gov.uk": "Veterans UK",
    "companieshouse.gov.uk": "Companies House",
    "caa.co.uk": "Civil Aviation Authority",
    "aviva.co.uk": "Aviva",
    "boots.com": "Boots",
    "marksandspencer.com": "M&S",
    "virginmoney.com": "Virgin Money",
    "paypal.com": "PayPal",
    "landg.com": "Legal & General",
    "royallondon.com": "Royal London",
}

PHASE_TITLES = {
    1: "Identity documents",
    2: "Government, legal and civic",
    3: "Money, health and work",
    4: "Home and utilities",
    5: "Online, shopping and travel",
}

SAMPLE_IDS = {
    "hm-passport-office", "dvla-licence", "dvla-v5c", "dva-vehicle", "hmrc", "hmrc-child-benefit",
    "gov-one-login", "slc", "tv-licensing", "hm-land-registry", "nhs-app", "bupa", "specsavers",
    "barclays", "hsbc", "lloyds", "halifax", "monzo", "nationwide", "natwest", "santander",
    "starling", "revolut", "amex", "barclaycard", "klarna", "paypal", "paypal-credit", "nsi",
    "hargreaves-lansdown", "nest", "aviva-pensions", "aviva-insurance", "aviva-health", "admiral",
    "octopus-energy", "british-gas", "thames-water", "ee", "virgin-media", "sky", "bt",
    "amazon", "apple-id", "google-account", "spotify", "netflix", "ebay", "nectar", "tesco-clubcard", "boots-advantage", "boots-pharmacy",
    "ba-executive-club", "easyjet", "trainline", "experian", "nmc", "o2", "vodafone",
    "ovo", "edf", "royal-mail",
}


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 1
    orgs = json.load(open(argv[1]))["organisations"]
    cats = {c["id"]: c for c in json.load(open(argv[2]))}
    sample = "--sample" in argv

    out = []
    for o in orgs:
        if o.get("kind") != "specific":
            continue
        if sample and o["id"] not in SAMPLE_IDS:
            continue
        domains = sorted({d.lower().strip() for d in o.get("match", {}).get("email_domains", [])} - BLOCKED)
        if not domains:
            continue
        out.append({
            "id": o["id"],
            "name": o["name"],
            "category": o["category"],
            "phase": o["phase"],
            "priority": o.get("priority"),
            "domains": domains,
        })

    used = {o["category"] for o in out}
    catalogue = {
        "version": 1,
        "generated_on": date.today().isoformat(),
        "sample": sample,
        "phases": {str(k): v for k, v in PHASE_TITLES.items()},
        "categories": {cid: cats[cid]["label"] for cid in sorted(used) if cid in cats},
        "groups": GROUP_LABELS,
        "organisations": sorted(out, key=lambda o: (o["phase"], o["name"].lower())),
    }
    dest = Path(__file__).resolve().parent.parent / "catalogue.json"
    dest.write_text(json.dumps(catalogue, ensure_ascii=False, indent=1) + "\n")
    print(f"Wrote {len(out)} organisations to {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

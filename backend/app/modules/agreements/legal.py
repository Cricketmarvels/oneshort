"""GoFindr Terms of Use (v2) and Privacy Notice (v1), written for the Digital Personal Data Protection Act, 2023,
the DPDP Rules, 2025 and the IT (Intermediary Guidelines) Rules, 2021.

Company and grievance-officer details come from settings (LEGAL_ENTITY_NAME and friends). Production refuses to start
without them, so a published document never shows a placeholder. Have Indian counsel review any wording change
before publishing a new version.
"""

from typing import Any

from app.core.config import Settings

TERMS_VERSION = 2
PRIVACY_VERSION = 1


def _who(s: Settings) -> dict[str, str]:
    missing = "[to be added before launch]"
    return {
        "entity": s.legal_entity_name or f"[Company name {missing}]",
        "address": s.legal_entity_address or f"[Registered address {missing}]",
        "officer": s.grievance_officer_name or f"[Grievance Officer {missing}]",
        "email": s.grievance_email or f"[privacy email {missing}]",
        "courts": s.legal_jurisdiction,
        "effective": s.legal_effective_date,
    }


def terms(s: Settings) -> dict[str, Any]:
    w = _who(s)
    return {
        "kind": "terms",
        "version": TERMS_VERSION,
        "title": "GoFindr Terms of Use",
        "effective_date": w["effective"],
        "is_material": True,
        "sections": [
            {
                "heading": "1. About GoFindr and these terms",
                "body": (
                    f'GoFindr is operated by {w["entity"]}, {w["address"]} ("GoFindr", "we"). These terms are an '
                    "agreement between you and us for the GoFindr app and website. By creating an account or using "
                    "GoFindr you agree to them. Our Privacy Notice explains how we handle your personal data."
                ),
            },
            {
                "heading": "2. Who can use GoFindr",
                "body": (
                    "You must be 18 or older. GoFindr is not designed for children and we do not currently offer "
                    "accounts for players under 18. You may hold one personal account, and the details you give "
                    "(name, mobile number, email) must be your own and accurate."
                ),
            },
            {
                "heading": "3. What GoFindr does, and what it does not do",
                "body": (
                    "GoFindr helps cricket, badminton and pickleball players, captains and teams find each other, "
                    "organise matches, keep squads and track shared match costs. We are a facilitator. We do not "
                    "organise, supervise, referee, insure or guarantee any match, venue, team or person. We do not "
                    "book grounds or courts: venue listings are for information, and you arrange bookings directly "
                    "with the venue."
                ),
            },
            {
                "heading": "4. Your account",
                "body": (
                    "Keep your login codes and password private. Never share a one-time code with anyone, including "
                    "people claiming to be from GoFindr. You are responsible for activity on your account. Tell us at "
                    f"{w['email']} if you think someone else has access to it."
                ),
            },
            {
                "heading": "5. Conduct and sportsmanship",
                "body": (
                    "Treat everyone with respect, on the field and in the app. Do not post or send anything that is "
                    "abusive, harassing, threatening, sexually explicit, hateful, discriminatory, defamatory, "
                    "misleading, illegal, or that infringes someone else's rights. Do not impersonate others, "
                    "upload photos of people without their permission, spam, manipulate ratings or results, or try "
                    "to access accounts or data that are not yours. Honour the commitments you make to captains and "
                    "teammates, and tell them early if you cannot play."
                ),
            },
            {
                "heading": "6. Safety and match risks",
                "body": (
                    "Sport carries a risk of injury. You take part voluntarily and are responsible for judging your "
                    "own fitness, using proper safety equipment and following venue rules. GoFindr does not verify "
                    "the identity, skill or background of other users beyond the checks described in the app, and "
                    "does not provide insurance. Meet in public venues and use your judgement. In an emergency, "
                    "contact local emergency services (112)."
                ),
            },
            {
                "heading": "7. Match fees and payments between players",
                "body": (
                    "Fee splits in GoFindr are records to help a captain share costs fairly. GoFindr does not process, "
                    "hold or guarantee any payment. Players pay captains directly by cash or UPI, and captains mark "
                    "payments as received. Any arrangement about money is between the players and captain "
                    "involved. Never share a UPI PIN, card number or password in GoFindr."
                ),
            },
            {
                "heading": "8. Content you share",
                "body": (
                    "You keep ownership of what you post: profile details, photos, team logos and covers, match "
                    "photos, posts and messages. You give GoFindr a non-exclusive, royalty-free licence to store, "
                    "display and process that content only to run GoFindr for you and the people you share it with. "
                    "Upload only content you have the right to share. We may remove content that breaks these "
                    "terms or the law."
                ),
            },
            {
                "heading": "9. Ratings, reports and moderation",
                "body": (
                    "Player and team ratings come from verified match results and peer ratings, and may be "
                    "moderated to prevent abuse. You can report a user, post or photo in the app. We review "
                    "reports, and may warn, restrict, suspend or remove accounts and content. Where we act on your "
                    "account we will tell you why, and you may ask us to review the decision."
                ),
            },
            {
                "heading": "10. Other services",
                "body": (
                    "GoFindr can link to services we do not control, such as CricHeroes profiles, WhatsApp and maps. "
                    "Their own terms and privacy policies apply when you use them. GoFindr only stores the CricHeroes "
                    "link you give us; we do not access your CricHeroes account or data."
                ),
            },
            {
                "heading": "11. Suspension and closing your account",
                "body": (
                    "You can delete your account at any time from Profile → Privacy & data. We may suspend or close "
                    "accounts that seriously or repeatedly break these terms, put others at risk, or where the law "
                    "requires it."
                ),
            },
            {
                "heading": "12. Our responsibility to you",
                "body": (
                    'We work to keep GoFindr available and accurate but provide it "as is". To the extent the law '
                    "allows, we are not liable for injuries, losses, disputes or costs arising from matches, venues, "
                    "payments or conduct between users, or for indirect losses. Nothing in these terms limits "
                    "rights you have as a consumer under Indian law that cannot be excluded."
                ),
            },
            {
                "heading": "13. Grievances",
                "body": (
                    f"Our Grievance Officer is {w['officer']}, reachable at {w['email']} or {w['address']}. You can "
                    "also raise a grievance in the app from Profile → Privacy & data. We acknowledge complaints about "
                    "content or conduct within 24 hours and resolve them within 15 days, as the IT Rules, 2021 "
                    "require, or sooner where those rules set a shorter time."
                ),
            },
            {
                "heading": "14. Changes to these terms",
                "body": (
                    "If we make a material change we will show you the new version in the app, and you will need to "
                    "accept it to keep using matchmaking features. We keep a record of the versions you accepted."
                ),
            },
            {
                "heading": "15. Law and disputes",
                "body": (
                    f"These terms are governed by the laws of India. Courts at {w['courts']} have jurisdiction, "
                    "subject to any right you have to approach a consumer forum."
                ),
            },
        ],
    }


def privacy(s: Settings) -> dict[str, Any]:
    w = _who(s)
    return {
        "kind": "privacy",
        "version": PRIVACY_VERSION,
        "title": "GoFindr Privacy Notice",
        "effective_date": w["effective"],
        "is_material": True,
        "sections": [
            {
                "heading": "1. Who is responsible for your data",
                "body": (
                    f"{w['entity']}, {w['address']}, operates GoFindr and is the Data Fiduciary for your personal "
                    "data under the Digital Personal Data Protection Act, 2023. Questions, requests and complaints: "
                    f"{w['officer']}, Grievance Officer, {w['email']}, or in the app at Profile → Privacy & data."
                ),
            },
            {
                "heading": "2. What we collect and why",
                "body": (
                    "Account: name, mobile number, email and password (stored only as a one-way hash). Used to "
                    "create and secure your account, sign you in and contact you about it.\n"
                    "Sport profile: sports, roles, skills, batting or bowling style, experience, availability, "
                    "ratings and match history. Used to match you with players, teams and games, and to show "
                    "verified ratings.\n"
                    "Location: your city and area, the home area you choose, and the location you search from. Used "
                    "to find people and games nearby. Other users only ever see your area and an approximate "
                    "distance, never your exact location.\n"
                    "Photos and media: profile photo, team logos and covers, match photos. We strip location and "
                    "camera data from every image when it is uploaded.\n"
                    "Activity: teams, matches, squads, invitations, join requests, chat messages, community posts, "
                    "reports and fee records (amounts and paid status; we never collect UPI PINs, card or bank "
                    "details). Used to run these features for you and the people you play with.\n"
                    "Optional: WhatsApp updates and a CricHeroes profile link, only if you turn them on or add them.\n"
                    "Security records: sign-in times, IP address, device and app version, and records of what you "
                    "accepted. Used to keep accounts safe, prevent abuse and meet legal duties."
                ),
            },
            {
                "heading": "3. Our basis for using your data",
                "body": (
                    "We process your data with your consent, which you give when you accept this notice, and for "
                    "the legitimate uses the Act allows, such as complying with law or a court order and responding "
                    "to emergencies. We use your data only for the purposes listed here. We do not sell your data, "
                    "show you third-party advertising, or build advertising profiles."
                ),
            },
            {
                "heading": "4. Who sees or receives your data",
                "body": (
                    "Other GoFindr users see what the features need: your name, photo, sports profile, rating, area "
                    "and approximate distance. Teammates and captains see your squad status and fee status. Your "
                    "mobile number is not shown to other players.\n"
                    "Service providers who process data for us under contract, and only on our instructions: "
                    "cloud hosting and storage, SMS and WhatsApp message delivery (to send login codes and the "
                    "notifications you choose), and error monitoring (which receives technical details with names, "
                    "phone numbers and emails removed).\n"
                    "Authorities, where the law requires it."
                ),
            },
            {
                "heading": "5. Where your data is stored",
                "body": (
                    "We aim to store your data in India. Some service providers may process data outside India. "
                    "We use only countries the Government of India has not restricted under section 16 of the Act, "
                    "with safeguards in our contracts."
                ),
            },
            {
                "heading": "6. How long we keep it",
                "body": (
                    "Account and sport profile: while your account is open. When you delete your account we remove "
                    "or anonymise your personal data straight away. Ratings, fee records and match results stay, "
                    'linked to "Deleted player", so other people\'s records remain correct.\n'
                    "Login codes: minutes. Failed-login records: up to 24 hours. Notifications: 180 days.\n"
                    "Security and processing logs, and records of consent: at least one year, as the DPDP Rules, "
                    "2025 require, then deleted.\n"
                    "If an account is inactive for a long period we may delete it. We will warn you at least 48 hours "
                    "before we do."
                ),
            },
            {
                "heading": "7. Your rights",
                "body": (
                    "You can:\n"
                    "• get a summary or a copy of your personal data (Profile → Privacy & data → Download my data);\n"
                    "• correct or update it (edit your profile, or ask us);\n"
                    "• have it erased (Delete account, or ask us);\n"
                    "• withdraw consent (turn off optional features, or delete your account; withdrawing does not "
                    "affect processing that already happened);\n"
                    "• nominate someone to exercise your rights if you die or become unable to;\n"
                    "• make a grievance.\n"
                    "Make a request in the app or at "
                    f"{w['email']}. We respond within 30 days and always within the 90 days the DPDP Rules allow. If "
                    "you are not satisfied with our response to a grievance, you can complain to the Data Protection "
                    "Board of India."
                ),
            },
            {
                "heading": "8. Children",
                "body": (
                    "GoFindr is only for people aged 18 or over, and you confirm your age when you join. We do not "
                    "knowingly process children's data. If we learn that an account belongs to someone under 18, we "
                    "close it and erase the data."
                ),
            },
            {
                "heading": "9. Keeping your data safe",
                "body": (
                    "We encrypt connections, store passwords and login codes only as one-way hashes, limit staff "
                    "access, keep access logs, strip metadata from images, rate-limit sign-ins and test the app for "
                    "security problems. If a personal data breach affects you, we will tell you promptly, explain "
                    "what happened and what you can do. We will also report it to the Data Protection Board as the "
                    "law requires."
                ),
            },
            {
                "heading": "10. Language and changes",
                "body": (
                    "You can ask for this notice in any language listed in the Eighth Schedule to the Constitution "
                    f"of India by writing to {w['email']}. If we change how we use your data, we will show you the "
                    "updated notice in the app and ask for your consent again where needed."
                ),
            },
        ],
    }

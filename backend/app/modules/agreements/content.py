"""Seed content for the Platform User Agreement (v1).

DRAFT: must be reviewed by legal counsel before public launch. Content is stored in
the ``agreements`` collection and is configurable; this module only seeds the first version.
"""

AGREEMENT_V1 = {
    "version": 1,
    "title": "CricketMarvels Play: Platform User Agreement (Draft v1)",
    "is_material": True,
    "sections": [
        {
            "heading": "1. What the platform does",
            "body": (
                "CricketMarvels Play is a matchmaking and team-management facilitator. We help "
                "players and captains find each other, organise matches and keep track of shared "
                "expenses. We do not organise, supervise, referee or guarantee any match, venue, "
                "team or participant."
            ),
        },
        {
            "heading": "2. Your responsibilities",
            "body": (
                "You participate voluntarily and are responsible for your own decisions, conduct "
                "and fitness to play. Provide accurate profile information, honour commitments you "
                "make, and inform your captain promptly if you cannot attend."
            ),
        },
        {
            "heading": "3. Conduct and sportsmanship",
            "body": (
                "Treat every participant with respect. Abusive language, harassment, threats, "
                "physical misconduct, discrimination, cheating and repeated no-shows are not "
                "tolerated and may lead to warnings, restriction of matchmaking or suspension."
            ),
        },
        {
            "heading": "4. Personal safety and match risks",
            "body": (
                "Cricket involves inherent risk of injury and damage to property. Use appropriate "
                "protective equipment, check the venue, and meet people you do not know in public, "
                "well-attended places. Do not share sensitive personal information unnecessarily."
            ),
        },
        {
            "heading": "5. Financial arrangements",
            "body": (
                "Match fees are agreed between participants and paid directly to the captain by "
                "any method you agree on (cash, UPI, bank transfer, etc.). The platform does not "
                "process or hold payments. Payment statuses are recorded manually by captains and "
                "are not verified by the platform. Raise a dispute in the app if you disagree with "
                "a recorded status. Never share your UPI PIN, passwords or bank credentials."
            ),
        },
        {
            "heading": "6. Reporting, moderation and disputes",
            "body": (
                "You can report misconduct from any profile or match. Reports are reviewed by "
                "human moderators, who may investigate, issue warnings, restrict matchmaking or "
                "suspend accounts. Automated tools may help prioritise reports, but decisions are "
                "made by people. Personal disputes between users should first be resolved between "
                "the parties; the platform may assist but is not an arbitrator."
            ),
        },
        {
            "heading": "7. Privacy and location",
            "body": (
                "We use your location only with your permission, to show you nearby matches and "
                "players. We never show your exact location to other users. Only an approximate "
                "distance is displayed. You can make your availability private, export your data, "
                "or delete your account at any time from Settings."
            ),
        },
        {
            "heading": "8. Suspension",
            "body": (
                "We may suspend or restrict accounts that breach this agreement, put others at risk, "
                "or misuse the platform, including temporarily while a report is investigated."
            ),
        },
        {
            "heading": "9. Limitation of liability",
            "body": (
                "To the extent permitted by applicable law, the platform is not liable for the "
                "independent conduct of users, personal disputes, injuries, loss or damage to "
                "property arising from matches or meetings arranged through the platform. Nothing "
                "in this agreement limits any liability that cannot be limited under applicable "
                "law, or liability arising from the platform's own conduct."
            ),
        },
        {
            "heading": "10. Changes",
            "body": (
                "If we make material changes to this agreement, we will ask you to review and "
                "accept the updated version before you can continue using matchmaking features."
            ),
        },
    ],
}

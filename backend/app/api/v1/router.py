"""Aggregates all module routers under /api/v1."""

from fastapi import APIRouter

from app.modules.admin.router import router as admin_router
from app.modules.agreements.router import router as agreements_router
from app.modules.assistant.router import router as assistant_router
from app.modules.auth.router import router as auth_router
from app.modules.availability.router import router as availability_router
from app.modules.captains.router import router as captains_router
from app.modules.chat.router import router as chat_router
from app.modules.communities.router import blocks_router
from app.modules.communities.router import router as communities_router
from app.modules.competition.router import router as competition_router
from app.modules.cricheroes.router import router as cricheroes_router
from app.modules.dashboard.router import router as dashboard_router
from app.modules.discovery.router import router as discovery_router
from app.modules.invitations.router import router as invitations_router
from app.modules.joinlinks.router import router as joinlinks_router
from app.modules.matches.router import router as matches_router
from app.modules.notifications.router import router as notifications_router
from app.modules.players.router import router as players_router
from app.modules.racket.router import router as racket_router
from app.modules.ratings.router import router as ratings_router
from app.modules.reports.router import router as reports_router
from app.modules.settlements.router import router as settlements_router
from app.modules.teams.router import router as teams_router
from app.modules.uploads.router import router as uploads_router
from app.modules.users.router import router as users_router
from app.modules.venues.router import router as venues_router
from app.modules.whatsapp.router import router as whatsapp_router

api_router = APIRouter()
for r in (
    auth_router,
    users_router,
    agreements_router,
    assistant_router,
    competition_router,  # before players/teams: /players/leaderboard, /teams/leaderboard etc.
    communities_router,
    blocks_router,
    players_router,
    whatsapp_router,
    chat_router,
    racket_router,
    captains_router,
    teams_router,
    cricheroes_router,
    availability_router,
    discovery_router,
    joinlinks_router,  # before matches: /matches/{id}/invite-link
    matches_router,
    invitations_router,
    settlements_router,
    ratings_router,
    notifications_router,
    reports_router,
    admin_router,
    uploads_router,
    venues_router,
    dashboard_router,
):
    api_router.include_router(r)

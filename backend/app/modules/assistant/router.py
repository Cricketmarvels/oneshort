from fastapi import APIRouter

from app.api.dependencies import ContainerDep, UserDep
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.modules.assistant.schemas import SearchIn, SearchOut
from app.modules.assistant.service import SmartSearch

router = APIRouter(tags=["Smart search"], responses=ERROR_RESPONSES)


@router.post(
    "/search/smart",
    response_model=Envelope[SearchOut],
    summary="Natural-language search: 'I want to play on Saturday morning'",
    description="Uses Claude to interpret and rank when ANTHROPIC_API_KEY is configured; otherwise a built-in "
    "interpreter. Results are always real, current records near the user.",
)
async def smart_search(data: SearchIn, user: UserDep, c: ContainerDep) -> Envelope[SearchOut]:
    return ok(await SmartSearch(c).search(user, data))

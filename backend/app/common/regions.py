"""City -> Indian state/UT lookup used for the "State" leaderboard scope.

Profiles store a city, not a state. Cities missing from this table are still ranked in
City and National scopes; they are simply absent from State scope until added here.
"""

CITY_STATE: dict[str, str] = {
    "noida": "Uttar Pradesh",
    "greater noida": "Uttar Pradesh",
    "ghaziabad": "Uttar Pradesh",
    "lucknow": "Uttar Pradesh",
    "kanpur": "Uttar Pradesh",
    "agra": "Uttar Pradesh",
    "varanasi": "Uttar Pradesh",
    "meerut": "Uttar Pradesh",
    "delhi": "Delhi",
    "new delhi": "Delhi",
    "gurugram": "Haryana",
    "gurgaon": "Haryana",
    "faridabad": "Haryana",
    "sonipat": "Haryana",
    "chandigarh": "Chandigarh",
    "jaipur": "Rajasthan",
    "mumbai": "Maharashtra",
    "pune": "Maharashtra",
    "nagpur": "Maharashtra",
    "thane": "Maharashtra",
    "navi mumbai": "Maharashtra",
    "bengaluru": "Karnataka",
    "bangalore": "Karnataka",
    "mysuru": "Karnataka",
    "hyderabad": "Telangana",
    "chennai": "Tamil Nadu",
    "coimbatore": "Tamil Nadu",
    "kolkata": "West Bengal",
    "ahmedabad": "Gujarat",
    "surat": "Gujarat",
    "vadodara": "Gujarat",
    "indore": "Madhya Pradesh",
    "bhopal": "Madhya Pradesh",
    "kochi": "Kerala",
    "thiruvananthapuram": "Kerala",
    "patna": "Bihar",
    "dehradun": "Uttarakhand",
    "ludhiana": "Punjab",
    "amritsar": "Punjab",
    "mohali": "Punjab",
    "bhubaneswar": "Odisha",
    "guwahati": "Assam",
    "visakhapatnam": "Andhra Pradesh",
    "ranchi": "Jharkhand",
    "raipur": "Chhattisgarh",
}


def state_for_city(city: str | None) -> str | None:
    return CITY_STATE.get((city or "").strip().casefold())


def cities_in_state(state: str) -> list[str]:
    s = state.strip().casefold()
    return [c for c, st in CITY_STATE.items() if st.casefold() == s]

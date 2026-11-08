import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export function NotFound() {
  return <EmptyState title="Out of bounds" body="We couldn't find that page." action={<Link to="/"><Button>Go home</Button></Link>} />;
}

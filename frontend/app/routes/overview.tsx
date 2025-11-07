import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "HQG Vault" },
    { name: "description", content: "HQG Vault Home" },
  ];
}

export default function Home() {
  return <>Overview</>;
}

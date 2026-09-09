import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CODWSAP",
    short_name: "CODWSAP",
    description: "Gestion mobile des commandes COD et des messages WhatsApp.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#1c5cf0",
    orientation: "portrait-primary",
  };
}

import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/app/Dashboard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NightShift Coder — offline AI coding bot for Windows" },
      {
        name: "description",
        content: "A desktop coding bot that writes and runs code for hours on your NVIDIA GPU, fully offline.",
      },
      { property: "og:title", content: "NightShift Coder — offline AI coding bot" },
      {
        property: "og:description",
        content: "Set a time, pick a goal, and let the bot keep coding in your terminal and editor.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

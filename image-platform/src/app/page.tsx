import { App } from "@/components/App";

export const dynamic = "force-dynamic";

export default function Home() {
  return <App appName={process.env.APP_NAME || "Lumen"} botUsername={process.env.TELEGRAM_BOT_USERNAME || ""} />;
}

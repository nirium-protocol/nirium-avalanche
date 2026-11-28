import type { Metadata } from "next";
import { Explorer } from "./Explorer";

// Its own link preview: a child openGraph replaces the layout's, so the image is listed again.
export const metadata: Metadata = {
  title: "Receipt explorer · Nirium on Avalanche",
  openGraph: {
    type: "website",
    siteName: "Nirium",
    url: "https://nirium.xyz/avalanche/explorer",
    title: "Receipt explorer · Nirium on Avalanche",
    description: "Paste a receipt's CID and check it against Avalanche, in your browser.",
    images: [{ url: "https://nirium.xyz/avalanche/og.png", width: 1200, height: 630, alt: "Nirium on Avalanche: a receipt signed by whoever pays, checked against Avalanche in the browser" }],
  },
  twitter: { card: "summary_large_image", title: "Receipt explorer · Nirium on Avalanche", description: "Paste a receipt's CID and check it against Avalanche, in your browser.", images: ["https://nirium.xyz/avalanche/og.png"] },
};

export default function ExplorerPage() {
  return <Explorer />;
}

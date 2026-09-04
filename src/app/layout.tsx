import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata={title:"Forge - AI infrastructure, with ANAI",description:"Forge is a fictional AI application infrastructure platform with the ANAI operating layer."};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}

export const shortcuts = [
  { id: "pc", label: "This PC", icon: "desktop" },
  { id: "projects", label: "Projects", icon: "folder" },
  { id: "atlas", label: "Atlas Drive", icon: "drive" },
  { id: "downloads", label: "Downloads", icon: "download" },
  { id: "terminal", label: "Terminal", icon: "terminal" },
  { id: "recycle", label: "Recycle Bin", icon: "recycle" },
  { id: "documents", label: "Documents", icon: "document" },
  { id: "code", label: "Code", icon: "code" },
  { id: "notes", label: "Notes", icon: "notes" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export const resources = [
  {
    id: "cpu",
    label: "CPU",
    value: "18%",
    meta: "2.92 GHz",
    points: [10, 14, 11, 16, 18, 13, 12, 15, 14, 17, 15, 16, 14, 13, 16, 18, 15],
  },
  {
    id: "memory",
    label: "MEMORY",
    value: "42%",
    meta: "13.3 / 31.3 GB",
    segments: 10,
  },
  {
    id: "disk",
    label: "DISK (D:)",
    value: "12%",
    meta: "512 GB / 4.00 TB",
    points: [11, 12, 10, 13, 9, 12, 11, 15, 13, 12, 14, 11, 12, 10, 14, 12, 13],
  },
  {
    id: "network",
    label: "NETWORK",
    value: "↑ 1.32 Gbps",
    secondary: "↓ 158 Mbps",
    points: [5, 8, 7, 12, 9, 13, 14, 11, 18, 15, 22, 17, 19, 24, 21, 27, 22],
  },
];

export const processes = [
  ["JARVIS Shell", "4.2%", "420 MB", "12 Mbps"],
  ["Code", "2.1%", "280 MB", "5 Mbps"],
  ["File Explorer", "1.8%", "190 MB", "3 Mbps"],
  ["SecureSync", "1.2%", "160 MB", "2 Mbps"],
  ["System", "0.9%", "100 MB", "1 Mbps"],
];

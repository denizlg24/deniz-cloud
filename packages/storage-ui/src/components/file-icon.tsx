import {
  ArchiveIcon,
  CodeIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileTypeIcon,
  ImageIcon,
  MusicIcon,
  VideoIcon,
} from "lucide-react";
import { type FileCategory, getFileCategory } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<FileCategory, typeof FileIcon> = {
  image: ImageIcon,
  video: VideoIcon,
  audio: MusicIcon,
  pdf: FileTextIcon,
  archive: ArchiveIcon,
  code: CodeIcon,
  text: FileTypeIcon,
  document: FileTextIcon,
  spreadsheet: FileSpreadsheetIcon,
  unknown: FileIcon,
};

const COLOR_MAP: Record<FileCategory, string> = {
  image: "text-pink-500",
  video: "text-purple-500",
  audio: "text-amber-500",
  pdf: "text-red-500",
  archive: "text-yellow-600",
  code: "text-emerald-500",
  text: "text-blue-500",
  document: "text-blue-600",
  spreadsheet: "text-green-600",
  unknown: "text-muted-foreground",
};

interface FileIconDisplayProps {
  mimeType: string | null;
  className?: string;
}

export function FileIconDisplay({ mimeType, className }: FileIconDisplayProps) {
  const category = getFileCategory(mimeType);
  const Icon = ICON_MAP[category];
  const color = COLOR_MAP[category];

  return <Icon className={cn("size-5", color, className)} />;
}

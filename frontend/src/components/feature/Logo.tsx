import { cn } from "@/utils/format";

const kentLogoFull = "/assets/images/kent-logo-full-dark.png";
const kentLogoMark = "/assets/images/Kent%20Business%20College%20logo.svg";

export default function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center overflow-hidden", collapsed && "justify-center")}>
      {collapsed ? (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background-50 ring-1 ring-background-200">
          <img
            src={kentLogoMark}
            alt="Kent Business College"
            className="h-8 w-8 object-contain"
          />
        </span>
      ) : (
        <img
          src={kentLogoFull}
          alt="Kent Business College"
          className="h-10 w-auto max-w-[176px] object-contain object-left"
        />
      )}
    </div>
  );
}

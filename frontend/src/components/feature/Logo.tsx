import { cn } from "@/utils/format";
import kentLogoFull from "../../../../assets/images/kent-logo-full-dark.png";
import kentLogoMark from "../../../../assets/images/Kent Business College logo.svg";

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

import { Link } from "react-router-dom";
import { getBreadcrumb } from "@/config/navigation";

export default function Breadcrumbs({ pathname }: { pathname: string }) {
  const crumbs = getBreadcrumb(pathname);
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
      {crumbs.map((crumb, index) => (
        <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
          {index > 0 ? (
            <span className="flex h-3.5 w-3.5 items-center justify-center text-sm text-foreground-300">
              <i className="ri-arrow-right-s-line"></i>
            </span>
          ) : null}
          {crumb.path ? (
            <Link
              to={crumb.path}
              className="whitespace-nowrap font-medium text-foreground-500 transition-colors hover:text-primary-600"
            >
              {crumb.label}
            </Link>
          ) : (
            <span className="truncate font-semibold text-foreground-900">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
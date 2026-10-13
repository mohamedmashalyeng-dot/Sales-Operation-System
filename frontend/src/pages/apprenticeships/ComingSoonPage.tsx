interface ComingSoonPageProps {
  title: string;
  icon: string;
}

export default function ComingSoonPage({ title, icon }: ComingSoonPageProps) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[1600px] items-center justify-center px-4 py-5 md:px-6 md:py-6">
      <div className="flex w-full max-w-xl flex-col items-center rounded-lg border border-background-200 bg-background-50 px-6 py-12 text-center shadow-kbc-sm">
        <span className="flex h-14 w-14 items-center justify-center rounded-md bg-primary-50 text-3xl text-primary-600">
          <i className={icon}></i>
        </span>
        <p className="mt-5 text-[11px] font-bold uppercase tracking-wider text-primary-600">
          Apprenticeships
        </p>
        <h1 className="mt-2 font-heading text-3xl font-extrabold text-foreground-950">{title}</h1>
        <p className="mt-4 font-heading text-4xl font-extrabold uppercase text-primary-700">
          COMMING SOON
        </p>
      </div>
    </div>
  );
}

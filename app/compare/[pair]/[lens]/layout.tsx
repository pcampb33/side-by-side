import { ProcessProvider } from "./process-context";

// The comparison and its process overlay (@process, intercepting /process)
// share one provider, so the overlay shows the mounted comparison's run.
export default function LensLayout({ children, process }: LayoutProps<"/compare/[pair]/[lens]">) {
  return (
    <ProcessProvider>
      {children}
      {process}
    </ProcessProvider>
  );
}

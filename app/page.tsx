import { CompareForm } from "./compare-form";
import { FeaturedList } from "./featured-list";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
      <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">Compare two public companies</h1>
      <p className="mt-4 max-w-xl text-lg text-muted">
        Pick two US-listed companies and a lens. Every number traces back to the SEC filing it came from.
      </p>
      <CompareForm />
      <FeaturedList />
    </main>
  );
}

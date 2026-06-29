import Hero from "./_sections/Hero";
import ProductScreens from "./_sections/ProductScreens";
import LayerCards from "./_sections/LayerCards";
import CTA from "./_sections/CTA";
import Footer from "./_sections/Footer";

export default function Home() {
  return (
    <>
      <div className="grain" aria-hidden />
      <main>
        <Hero />
        <ProductScreens />
        <LayerCards />
        <CTA />
      </main>
      <Footer />
    </>
  );
}

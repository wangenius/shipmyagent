import type { FC } from "react";
import { Link } from "react-router";
import { GithubIcon } from "lucide-react";

export const Footer: FC = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="py-16 md:py-24 bg-[#000] text-[#fff]">
      {/* Thick horizontal rule - inverted */}
      <div className="h-1 bg-[#fff]" />

      <div className="mx-auto w-full max-w-6xl px-6 md:px-8 lg:px-12 pt-16 md:pt-24">
        <div className="grid grid-cols-12 gap-8 md:gap-12">
          {/* Brand */}
          <div className="col-span-12 md:col-span-4 lg:col-span-3">
            <Link to="/" className="inline-block mb-6">
              <span
                className="text-2xl md:text-3xl font-normal"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                Vibecape
              </span>
            </Link>
            <p className="text-sm text-[#A3A3A3] leading-relaxed mb-6">
              AI-powered writing assistant with local-first document management.
            </p>
            <Link
              to="https://github.com/wangenius/vibecape"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-[#A3A3A3] hover:text-[#fff] transition-colors duration-100"
            >
              <GithubIcon size={16} strokeWidth={1.5} />
              <span>GitHub</span>
            </Link>
          </div>

          {/* Links */}
          <div className="col-span-6 md:col-span-4 lg:col-span-2 lg:col-start-6">
            <h4 className="text-xs uppercase tracking-[0.2em] mb-6 text-[#fff]">
              Product
            </h4>
            <ul className="space-y-3">
              <li>
                <Link
                  to="/features"
                  className="text-sm text-[#A3A3A3] hover:text-[#fff] transition-colors duration-100"
                >
                  Features
                </Link>
              </li>
              <li>
                <Link
                  to="/docs"
                  className="text-sm text-[#A3A3A3] hover:text-[#fff] transition-colors duration-100"
                >
                  Documentation
                </Link>
              </li>
              <li>
                <Link
                  to="https://github.com/wangenius/vibecape/releases"
                  target="_blank"
                  className="text-sm text-[#A3A3A3] hover:text-[#fff] transition-colors duration-100"
                >
                  Releases
                </Link>
              </li>
            </ul>
          </div>

          <div className="col-span-6 md:col-span-4 lg:col-span-2">
            <h4 className="text-xs uppercase tracking-[0.2em] mb-6 text-[#fff]">
              Resources
            </h4>
            <ul className="space-y-3">
              <li>
                <Link
                  to="https://github.com/wangenius/vibecape"
                  target="_blank"
                  className="text-sm text-[#A3A3A3] hover:text-[#fff] transition-colors duration-100"
                >
                  GitHub
                </Link>
              </li>
              <li>
                <Link
                  to="https://github.com/wangenius/vibecape/issues"
                  target="_blank"
                  className="text-sm text-[#A3A3A3] hover:text-[#fff] transition-colors duration-100"
                >
                  Issues
                </Link>
              </li>
              <li>
                <Link
                  to="https://github.com/wangenius/vibecape/discussions"
                  target="_blank"
                  className="text-sm text-[#A3A3A3] hover:text-[#fff] transition-colors duration-100"
                >
                  Discussions
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-16 md:mt-24 pt-8 border-t border-[#333]">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <p className="text-xs text-[#A3A3A3] uppercase tracking-[0.15em]">
              © {currentYear} Vibecape. Open source under MIT License.
            </p>
            <p className="text-xs text-[#A3A3A3] uppercase tracking-[0.15em]">
              Made with intent
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

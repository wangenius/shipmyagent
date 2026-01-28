import type { FC } from "react";
import { Link } from "react-router";
import { IconBrandGithub } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { product } from "@/lib/product";

export const Footer: FC = () => {
  const currentYear = new Date().getFullYear();
  const { t } = useTranslation();

  return (
    <footer className="py-12 md:py-16 bg-muted text-muted-foreground border-t">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          {/* Brand */}
          <div className="md:col-span-1">
            <Link to="/" className="inline-block mb-4">
              <span className="text-lg font-bold text-foreground">
                {product.productName}
              </span>
            </Link>
            <p className="text-sm leading-relaxed mb-4">{t("hero:subtitle")}</p>
            <Link
              to="https://github.com/wangenius/shipmyagent"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm hover:text-foreground transition-colors"
            >
              <IconBrandGithub size={16} />
              <span>GitHub</span>
            </Link>
          </div>

          {/* Links */}
          <div className="md:col-start-3">
            <h4 className="text-sm font-medium mb-4 text-foreground">
              Product
            </h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link
                  to="/"
                  className="hover:text-foreground transition-colors"
                >
                  Features
                </Link>
              </li>
              <li>
                <Link
                  to="/docs"
                  className="hover:text-foreground transition-colors"
                >
                  Documentation
                </Link>
              </li>
              <li>
                <Link
                  to="https://github.com/wangenius/shipmyagent/releases"
                  target="_blank"
                  className="hover:text-foreground transition-colors"
                >
                  Releases
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-4 text-foreground">
              Resources
            </h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link
                  to="https://github.com/wangenius/shipmyagent"
                  target="_blank"
                  className="hover:text-foreground transition-colors"
                >
                  GitHub
                </Link>
              </li>
              <li>
                <Link
                  to="https://github.com/wangenius/shipmyagent/issues"
                  target="_blank"
                  className="hover:text-foreground transition-colors"
                >
                  Issues
                </Link>
              </li>
              <li>
                <Link
                  to="https://twitter.com/shipmyagent"
                  target="_blank"
                  className="hover:text-foreground transition-colors"
                >
                  Twitter
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-8 pt-8 border-t flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-sm">
          <p>
            © {currentYear} {product.productName}. Open source under MIT
            License.
          </p>
          <p>Made with intent</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

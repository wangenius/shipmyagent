import type { FC } from "react";
import { Link } from "react-router";
import { IconBrandGithub } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { product } from "@/lib/product";

export const Footer: FC = () => {
  const currentYear = new Date().getFullYear();
  const { i18n, t } = useTranslation();
  const docsPath = i18n.language === "zh" ? "/zh/docs" : "/en/docs";
  const homePath = i18n.language === "zh" ? "/zh" : "/";
  const featuresPath = i18n.language === "zh" ? "/zh/features" : "/features";

  return (
    <footer className="py-12 md:py-16 bg-muted text-muted-foreground border-t">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          {/* Brand */}
          <div className="md:col-span-1">
            <Link to={homePath} className="inline-block mb-4">
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
              <span>{t("footer.github")}</span>
            </Link>
          </div>

          {/* Links */}
          <div className="md:col-start-3">
            <h4 className="text-sm font-medium mb-4 text-foreground">
              {t("footer.product")}
            </h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link
                  to={featuresPath}
                  className="hover:text-foreground transition-colors"
                >
                  {t("footer.features")}
                </Link>
              </li>
              <li>
                <Link
                  to={docsPath}
                  className="hover:text-foreground transition-colors"
                >
                  {t("footer.documentation")}
                </Link>
              </li>
              <li>
                <Link
                  to="https://github.com/wangenius/shipmyagent/releases"
                  target="_blank"
                  className="hover:text-foreground transition-colors"
                >
                  {t("footer.releases")}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-4 text-foreground">
              {t("footer.resources")}
            </h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link
                  to="https://github.com/wangenius/shipmyagent"
                  target="_blank"
                  className="hover:text-foreground transition-colors"
                >
                  {t("footer.github")}
                </Link>
              </li>
              <li>
                <Link
                  to="https://github.com/wangenius/shipmyagent/issues"
                  target="_blank"
                  className="hover:text-foreground transition-colors"
                >
                  {t("footer.issues")}
                </Link>
              </li>
              <li>
                <Link
                  to="https://twitter.com/shipmyagent"
                  target="_blank"
                  className="hover:text-foreground transition-colors"
                >
                  {t("footer.twitter")}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-8 pt-8 border-t flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-sm">
          <p>
            {t("footer.copyright", {
              year: currentYear,
              productName: product.productName,
            })}
          </p>
          <p>{t("footer.madeWithIntent")}</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

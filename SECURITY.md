# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately. Do not open a public GitHub issue, discussion,
or pull request before the report has been reviewed.

Contact project maintainer Aaron Decker through [www.ard.ninja](https://www.ard.ninja). Include the
affected PureJsImage version or commit, the security impact, a minimal reproduction, and any
conditions required to trigger the issue. If the report needs a hostile image fixture, arrange a
private transfer instead of posting it publicly.

Reports about unsafe parsing of attacker-controlled images, bypasses of documented resource limits,
unexpected filesystem or system access, release or package-integrity problems, and other impacts on
applications using PureJsImage are in scope. Security fixes target the latest release and `main`;
older `0.x` releases may require upgrading.

## Development dependencies

PureJsImage ships with no runtime dependency tree. Packages in `devDependencies` are used only to
develop, test, or benchmark the project and are not installed as dependencies of the published
package.

Do not report an advisory against a development-only package as a PureJsImage product vulnerability
solely because a package audit lists it. It is not part of the code shipped to PureJsImage users.

A development dependency issue is still in scope when it can compromise this repository's CI,
release credentials, build process, generated artifacts, or the integrity of the published package.
Report those supply-chain risks privately using the same contact process.

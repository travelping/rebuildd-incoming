# rebuildd-incoming
This is a small node.js daemon that watches a given directory using inotify
and pushes packages into an internal queue when a debian source package is uploaded
to that directory. The daemon exposes a small cli to control which of the uploaded
packages should be build and whether to rebuild packages already in repository which
depend on a prior version of the new package. Finished packages of a 'batch' are
stored in a temporal repository and moved to the main repository upon successfull
build of all packages.

## Installation
Installation requires [npm](http://npmjs.org).

After you've cloned the repo, run `npm install` in the checkout
in order to fetch the dependencies. Then run `sudo npm link` to
symlink the daemon into /usr/local.

There's an example init script (for upstart) in the etc/ directory.

Configuration is handled via the command line.
Run `rebuildd-incoming --help` to see available options.

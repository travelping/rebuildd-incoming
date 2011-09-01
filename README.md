# rebuildd-incoming
This is a small node.js daemon that watches a given directory using inotify
and pushes packages into the rebuildd queue when a debian source package is uploaded
to that directory.

## Installation
Installation requires [npm](http://npmjs.org).

After you've cloned the repo, run `npm install` in the checkout
in order to fetch the dependencies. Then run `sudo npm link` to
symlink the daemon into /usr/local.

There's a example init script (for upstart) in the etc/ directory.

Configuration is handled via the command line.
Run `rebuildd-incoming --help` to see available options.

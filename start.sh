#!/bin/sh
su www-data -s /bin/sh -c 'cd /var/www/blog && hugo server -e production --disableFastRender --port=4637 --watch --renderToDisk --baseURL="https://blog.xylearn.site/" --appendPort=false'

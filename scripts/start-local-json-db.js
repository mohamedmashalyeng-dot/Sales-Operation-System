'use strict';

process.env.USE_LOCAL_JSON_DB = 'true';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
require('../server');

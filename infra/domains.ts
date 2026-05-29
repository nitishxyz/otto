const SUB = $app.stage === 'prod' ? '' : `${$app.stage}.`;

const HOST = 'ottocode.io';

export const domains = {
	landing: `${SUB}${HOST}`,
	landingWww: `www.${SUB}${HOST}`,
	app: `${SUB}app.${HOST}`,
	sh: `${SUB}install.${HOST}`,
	previewApi: `${SUB}api.share.${HOST}`,
	previewWeb: `${SUB}share.${HOST}`,
	ottorouter: `${SUB}ottorouter.${HOST}`,
};

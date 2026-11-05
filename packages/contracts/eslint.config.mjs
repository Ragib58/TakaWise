import { forbidServerOnlyImports } from '@takawise/eslint-config/base';
import { node } from '@takawise/eslint-config/node';

export default [...node({ tsconfigRootDir: import.meta.dirname }), forbidServerOnlyImports];

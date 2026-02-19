import { EarthmoverBundleTypes, IEarthmoverBundle } from '@edanalytics/models';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class EarthbeamBundlesService {
  private readonly logger = new Logger(EarthbeamBundlesService.name);

  private bundleUrl: string;
  private bundles: Record<EarthmoverBundleTypes, IEarthmoverBundle[]> | undefined;
  private bundlesLastUpdated: Date | undefined;
  private bundlesCacheSec = 5 * 60;
  constructor(private readonly configService: AppConfigService) {
    const branch = this.configService.bundleBranch();
    this.bundleUrl = `https://raw.githubusercontent.com/edanalytics/earthmover_edfi_bundles/refs/heads/${branch}/registry.json`;
  }

  async onModuleInit() {
    await this.fetchBundles();
    this.logger.log('Earthmover bundles loaded');
  }

  private bundleCacheExpired() {
    return (
      !this.bundlesLastUpdated ||
      new Date().getTime() - this.bundlesLastUpdated.getTime() > this.bundlesCacheSec * 1000
    );
  }
  private async fetchBundles() {
    let res: Response;
    try {
      res = await fetch(this.bundleUrl);
    } catch (e) {
      this.logger.error(`Error fetching bundles: ${e}`);
      if (!this.bundles) throw e;
      this.logger.warn(
        `Serving cached bundles last fetched at ${this.bundlesLastUpdated?.toDateString()}`
      );
      return;
    }

    if (!res.ok) {
      this.logger.error(`Error fetching bundles: GitHub returned ${res.status} ${res.statusText}`);
      if (!this.bundles) throw new Error(`GitHub returned ${res.status} ${res.statusText}`);
      this.logger.warn(
        `Serving cached bundles last fetched at ${this.bundlesLastUpdated?.toDateString()}`
      );
      return;
    }

    this.bundles = await res.json();
    this.bundlesLastUpdated = new Date();
  }

  async getBundles(type: EarthmoverBundleTypes) {
    if (this.bundleCacheExpired()) {
      await this.fetchBundles();
    }

    if (!this.bundles) {
      this.logger.error('Bundles not loaded');
      throw new Error('Bundles not loaded');
    }

    return this.bundles[type];
  }

  async getBundle(type: EarthmoverBundleTypes, path: string) {
    const bundles = await this.getBundles(type);
    return bundles.find((bundle) => bundle.path === path);
  }
}

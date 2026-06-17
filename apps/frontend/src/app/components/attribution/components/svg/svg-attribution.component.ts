import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-svg-attribution',
  imports: [],
  templateUrl: './svg-attribution.component.html',
  styleUrl: './svg-attribution.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SvgAttributionComponent {
  svgList = [
    {
      name: 'Crime Scene SVG Vector',
      license: 'CC0 License',
      url: 'https://www.svgrepo.com/svg/50584/crime-scene',
    },
    {
      name: 'Gun SVG Vector',
      license: 'CC0 License',
      url: 'https://www.svgrepo.com/svg/213697/gun',
    },
    {
      name: 'Punch SVG Vector by game-icons.net',
      license: 'CC Attribution License',
      url: 'https://www.svgrepo.com/svg/321251/punch',
    },
    {
      name: 'Car Run Over Man SVG Vector',
      license: 'CC0 License',
      url: 'https://www.svgrepo.com/svg/123641/car-run-over',
    },
    {
      name: 'Cannabis SVG Vector',
      license: 'MIT License',
      url: 'https://www.svgrepo.com/svg/443615/cannabis',
    },
    {
      name: 'Marijuana Dispensary Marijuana SVG Vector',
      license: 'CC0 License',
      url: 'https://www.svgrepo.com/svg/307933/marijuana-dispensary-marijuana-dealer-drug-dealer',
    },
    {
      name: 'Car Crash Solid SVG Vector',
      license: 'MIT License',
      url: 'https://www.svgrepo.com/svg/313639/car-crash-solid',
    },
    {
      name: 'iPhone SVG Vector',
      license: 'OFL License',
      url: 'https://www.svgrepo.com/svg/500906/iphone',
    },
    {
      name: 'Theft Crime Steal Thief SVG Vector',
      license: 'CC0 License',
      url: 'https://www.svgrepo.com/svg/307146/theft-crime-steal-thief',
    },
    {
      name: 'Addiction Drug Joint SVG Vector by Alpár-Etele Méder',
      license: 'CC Attribution License',
      url: 'https://www.svgrepo.com/svg/454647/addiction-drug-joint',
    },
    {
      name: 'Sex Copulation Pornography Sexual Relationship SVG Vector from Activity Infographic Icons collection',
      license: 'CC0 License',
      url: 'https://www.svgrepo.com/svg/308074/sex-copulation-pornography-sexual-relationship',
    },
    {
      name: 'Point SVG Vector by Shannon E. Thomas',
      license: 'CC Attribution License',
      url: 'https://www.svgrepo.com/svg/412249/point',
    },
    {
      name: 'Alert SVG Vector by Shannon E. Thomas',
      license: 'CC Attribution License',
      url: 'https://www.svgrepo.com/svg/412147/alert',
    },
    {
      name: 'Hand Pills SVG Vector by Solar Icons',
      license: 'CC Attribution License',
      url: 'https://www.svgrepo.com/svg/412147/alert',
    },
    {
      name: 'Fist Raised SVG Vector by FontAwesome',

      license: 'CC Attribution License',
      url: 'https://www.svgrepo.com/svg/352048/fist-raised',
    },
    {
      name: 'Fragile Glass SVG Vector by Ankush Syal',
      license: 'CC Attribution License',
      url: 'https://www.svgrepo.com/svg/520745/fragile-glass',
    },
  ];
}

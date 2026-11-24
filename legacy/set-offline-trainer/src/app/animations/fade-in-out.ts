import {
  animation, trigger, animateChild, group,
  transition, animate, style, query
} from '@angular/animations';

export const fadeInOut = animation([
  transition(':enter', [   // :enter is alias to 'void => *'
    style({ opacity: 0 }),
    animate(100, style({ opacity: 1 }))
  ]),
  transition(':leave', [   // :leave is alias to '* => void'
    animate(200, style({ opacity: 0 }))
  ])
]);

// trigger('fadeInOut', [
//   transition(':enter', [   // :enter is alias to 'void => *'
//     style({ opacity: 0 }),
//     animate(100, style({ opacity: 1 }))
//   ]),
//   transition(':leave', [   // :leave is alias to '* => void'
//     animate(200, style({ opacity: 0 }))
//   ])
// ])
